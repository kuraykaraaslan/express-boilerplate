import { IsNull, Not } from 'typeorm';
import { withSystemRLS, withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { encryptField, decryptField } from '@kuraykaraaslan-labs/common/server/field-encryption';
import Logger from '@kuraykaraaslan-labs/logger';
import { TenantDomain } from './entities/tenant_domain.entity';
import { TenantDomainCertificate } from './entities/tenant_domain_certificate.entity';
import { isCertEligibleDomain } from './tenant_domain.serving';
import { managedBases } from './tenant_domain.base-domains';
import { isProbeableHost } from './ssl_provisioning.probe';
import type { IssuedCertificate } from './tenant_domain.acme.client';
import { DEFAULT_RENEW_BEFORE_DAYS, RATE_LIMIT_MIN_BACKOFF_MS, backoffMs, ownCertificate, renewAfterOf, sanitizeOrderError } from './tenant_domain.certificates.policy';
import { acmeConfig } from './tenant_domain.acme.config';

/**
 * The certificates the platform holds for its own domains (phase 51.2): the store behind the queue (51.3) and the answer the TLS
 * terminator asks for on every handshake (`/internal/api/tls-cert`).
 *
 * The handshake path is hot (Caddy 2.6 does not cache what it is given), so `servableCertificate` answers from a bounded in-process
 * cache: 60 s for a certificate, 15 s for "none" (a new certificate is then served within a quarter of a minute on every process).
 * Every write here drops the host's entry in this process; the other processes catch up by the TTL.
 */
export interface HeldCertificate {
  /** Leaf first, then the chain. */
  certPem: string;
  keyPem: string;
  notAfter: Date;
}

export const CERT_STATUS = { PENDING: 'PENDING', ACTIVE: 'ACTIVE', FAILED: 'FAILED' } as const;

const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 15_000;
const MAX_CACHED_HOSTS = 2_000;

type CacheEntry = { at: number; value: HeldCertificate | null };
const cache = new Map<string, CacheEntry>();

export function invalidateCertificateCache(host?: string): void {
  if (host === undefined) cache.clear();
  else cache.delete(host.trim().toLowerCase());
}

function remember(host: string, value: HeldCertificate | null): void {
  if (cache.size >= MAX_CACHED_HOSTS) {
    // Oldest first (Map keeps insertion order): a flood of random server names cannot grow the process without bound.
    for (const key of Array.from(cache.keys()).slice(0, Math.ceil(MAX_CACHED_HOSTS / 10))) cache.delete(key);
  }
  cache.set(host, { at: Date.now(), value });
}

/**
 * The domain row a handshake for `host` would be served from, when the platform may hold a certificate for it: the same rule as the
 * TLS ask (`isProvisioningAllowed`) without that call's side effect. Proven row first (tenant_domain.02), an ACTIVE tenant only (common.12).
 */
export async function eligibleDomainRow(host: string): Promise<TenantDomain | null> {
  if (!isProbeableHost(host)) return null;
  const row = await withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantDomain);
    return (await repo.findOne({ where: { domain: host, verifiedAt: Not(IsNull()) } })) ?? repo.findOne({ where: { domain: host } });
  });
  if (!row || !isCertEligibleDomain(row, await managedBases())) return null;
  const tenant = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).findOne({ where: { tenantId: row.tenantId } }));
  return tenant && tenant.tenantStatus === 'ACTIVE' ? row : null;
}

/** The certificate and key to hand the TLS terminator for `serverName`, or null (no row, not servable, expired, key unreadable). Never throws. */
/**
 * What `tls-cert` hands Caddy for `serverName` (phase 56, D344), in order: the wildcard of the ACTIVE managed base domain the host sits one
 * label under, for ANY name there (a tenant's, a reserved one, a typo: the proxy decides what it shows, not the handshake); else the
 * per-name certificate the platform holds for the host (a custom domain; a platform subdomain while its base has no wildcard yet); else
 * nothing (204, the handshake is refused).
 */
export async function servableCertificate(serverName: string): Promise<HeldCertificate | null> {
  const host = serverName.trim().toLowerCase();
  try {
    const { wildcardCertificateFor } = await import('./tenant_domain.base-certificates.service');
    const wildcard = await wildcardCertificateFor(host);
    if (wildcard) return wildcard;
  } catch (err) {
    Logger.warn(`[tls-cert] wildcard lookup failed for ${JSON.stringify(host)}: ${err instanceof Error ? err.message : 'unknown'}`);
  }
  return perNameCertificate(host);
}

/** The per-name certificate of phase 51 for `host` (cached per host). */
async function perNameCertificate(host: string): Promise<HeldCertificate | null> {
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < (hit.value ? HIT_TTL_MS : MISS_TTL_MS)) return hit.value;
  let value: HeldCertificate | null = null;
  try {
    const domain = await eligibleDomainRow(host);
    if (domain) {
      const cert = await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainCertificate).findOne({ where: { tenantDomainId: domain.tenantDomainId } }));
      // A renamed free subdomain keeps its row (same domain id) with the OLD name until the new order replaces it, and a row another authority
      // issued (the staging directory of a first round) is not this installation's certificate: neither is ever handed out.
      const own = ownCertificate(cert, host, acmeConfig()?.directoryUrl ?? null);
      if (own?.certPem && own.privateKeyEnc && own.notAfter && own.notAfter.getTime() > Date.now()) {
        value = { certPem: own.certPem, keyPem: decryptField(own.privateKeyEnc), notAfter: own.notAfter };
      }
    }
  } catch (err) {
    // The error is the field-decrypt or database failure's own message: it carries no key material. Fail closed, retry after the miss TTL.
    Logger.warn(`[tls-cert] lookup failed for ${JSON.stringify(host)}: ${err instanceof Error ? err.message : 'unknown'}`);
    value = null;
  }
  remember(host, value);
  return value;
}

export interface DomainRef { tenantId: string; tenantDomainId: string; domain: string }

/** Stores a freshly issued certificate (the private key sealed under the node key) and clears the failure state. */
export async function saveIssuedCertificate(ref: DomainRef, issued: IssuedCertificate, renewBeforeDays: number = DEFAULT_RENEW_BEFORE_DAYS, directoryUrl: string | null = null): Promise<void> {
  await withTenantRepositoryFor(ref.tenantId, TenantDomainCertificate, (repo) => repo.upsert({
    tenantId: ref.tenantId,
    tenantDomainId: ref.tenantDomainId,
    domain: ref.domain,
    status: CERT_STATUS.ACTIVE,
    directoryUrl,
    certPem: issued.certPem,
    privateKeyEnc: encryptField(issued.keyPem),
    notBefore: issued.notBefore,
    notAfter: issued.notAfter,
    issuedAt: new Date(),
    renewAfter: renewAfterOf(issued.notAfter, renewBeforeDays),
    attempts: 0,
    lastError: null,
    lastAttemptAt: new Date(),
    retryAt: null,
  }, ['tenantDomainId']));
  invalidateCertificateCache(ref.domain);
}

export interface OrderFailure { message: string; rateLimited?: boolean; retryAfterMs?: number | null }

/**
 * Records a failed order: the attempt count, the (sanitised) reason and when the queue may try again. A certificate that is still held stays
 * ACTIVE and keeps being served; a domain with none is FAILED.
 */
export async function recordOrderFailure(ref: DomainRef, failure: OrderFailure, now: Date = new Date(), directoryUrl: string | null = null): Promise<{ attempts: number; retryAt: Date }> {
  return withTenantRepositoryFor(ref.tenantId, TenantDomainCertificate, async (repo) => {
    const row = await repo.findOne({ where: { tenantDomainId: ref.tenantDomainId } });
    const attempts = (row?.attempts ?? 0) + 1;
    const wait = failure.rateLimited ? Math.max(failure.retryAfterMs ?? 0, RATE_LIMIT_MIN_BACKOFF_MS) : backoffMs(attempts);
    const retryAt = new Date(now.getTime() + wait);
    const fields = {
      attempts,
      lastError: sanitizeOrderError(failure.message),
      lastAttemptAt: now,
      retryAt,
      status: ownCertificate(row, ref.domain, directoryUrl)?.certPem ? CERT_STATUS.ACTIVE : CERT_STATUS.FAILED,
    };
    if (row) await repo.update({ tenantDomainId: ref.tenantDomainId, tenantId: ref.tenantId }, fields);
    else await repo.insert({ tenantId: ref.tenantId, tenantDomainId: ref.tenantDomainId, domain: ref.domain, ...fields });
    return { attempts, retryAt };
  });
}

/** Removes the certificate row of a domain (the domain was deleted). Its key goes with it. */
export async function deleteCertificateOf(ref: { tenantId: string; tenantDomainId: string; domain?: string }): Promise<void> {
  await withTenantRepositoryFor(ref.tenantId, TenantDomainCertificate, (repo) => repo.delete({ tenantDomainId: ref.tenantDomainId, tenantId: ref.tenantId }));
  invalidateCertificateCache(ref.domain);
}
