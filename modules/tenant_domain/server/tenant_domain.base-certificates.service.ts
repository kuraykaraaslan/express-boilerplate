import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import { encryptField, decryptField } from '@kuraykaraaslan-labs/common/server/field-encryption';
import Logger from '@kuraykaraaslan-labs/logger';
import { TenantDomainBaseDomainCertificate } from './entities/tenant_domain_base_domain_certificate.entity';
import { wildcardCoverOf } from './tenant_domain.serving';
import { baseDomainList, type BaseDomainEntry } from './tenant_domain.base-domains';
import type { IssuedCertificate } from './tenant_domain.acme.client';
import { DEFAULT_RENEW_BEFORE_DAYS, RATE_LIMIT_MIN_BACKOFF_MS, backoffMs, ownCertificate, renewAfterOf, sanitizeOrderError } from './tenant_domain.certificates.policy';
import { acmeConfig } from './tenant_domain.acme.config';
import type { HeldCertificate, OrderFailure } from './tenant_domain.certificates.service';

/**
 * The wildcard certificates of the managed base domains (phase 56, D343, D344): the store behind the base-domain orders and the first
 * answer `tls-cert` gives. A host one label under an ACTIVE base domain gets the base's wildcard, tenant or not (that is what lets a
 * mistyped address reach the proxy's "no organization here" page instead of failing the handshake). Cached per base domain, not per host:
 * one entry serves every host under it (60 s for a certificate, 15 s for none).
 */
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 15_000;
const cache = new Map<string, { at: number; value: HeldCertificate | null }>();

export function invalidateBaseCertificateCache(baseDomain?: string): void {
  heldCache = null;
  if (baseDomain === undefined) cache.clear();
  else cache.delete(baseDomain.trim().toLowerCase());
}

/** The names a base domain's wildcard certificate carries: the base itself first, then `*.<base>`. */
export function wildcardNamesOf(baseDomain: string): string[] {
  const b = baseDomain.trim().toLowerCase();
  return [b, `*.${b}`];
}

/** The ACTIVE base domain whose wildcard covers `host` (one label under it, longest base first), or null. */
export function coveringBase(host: string, list: readonly BaseDomainEntry[]): BaseDomainEntry | null {
  const active = list.filter((b) => b.status === 'ACTIVE' && b.baseDomainId);
  const cover = wildcardCoverOf(host, active.map((b) => ({ name: b.baseDomain, purpose: b.purpose })));
  return cover ? active.find((b) => b.baseDomain === cover) ?? null : null;
}

export async function findBaseCertificate(baseDomainId: string): Promise<TenantDomainBaseDomainCertificate | null> {
  return withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomainCertificate).findOne({ where: { baseDomainId } }));
}

/** The wildcard certificate for `host`, or null when no ACTIVE base covers it or its base holds no good certificate. Fails closed. */
export async function wildcardCertificateFor(host: string): Promise<HeldCertificate | null> {
  const base = coveringBase(host, await baseDomainList());
  if (!base?.baseDomainId) return null;
  const hit = cache.get(base.baseDomain);
  if (hit && Date.now() - hit.at < (hit.value ? HIT_TTL_MS : MISS_TTL_MS)) return hit.value;
  let value: HeldCertificate | null = null;
  try {
    const own = ownCertificate(await findBaseCertificate(base.baseDomainId), base.baseDomain, acmeConfig()?.directoryUrl ?? null);
    if (own?.certPem && own.privateKeyEnc && own.notAfter && own.notAfter.getTime() > Date.now()) {
      value = { certPem: own.certPem, keyPem: decryptField(own.privateKeyEnc), notAfter: own.notAfter };
    }
  } catch (err) {
    // The decrypt or database failure's own message: no key material. Fail closed; the per-name certificate may still answer.
    Logger.warn(`[tls-cert] wildcard lookup failed for ${JSON.stringify(base.baseDomain)}: ${err instanceof Error ? err.message : 'unknown'}`);
    value = null;
  }
  cache.set(base.baseDomain, { at: Date.now(), value });
  return value;
}

export interface BaseRef { baseDomainId: string; baseDomain: string }

export async function saveBaseCertificate(ref: BaseRef, issued: IssuedCertificate, renewBeforeDays: number = DEFAULT_RENEW_BEFORE_DAYS, directoryUrl: string | null = null): Promise<void> {
  await withSystemRLS((qr) => qr.manager.getRepository(TenantDomainBaseDomainCertificate).upsert({
    baseDomainId: ref.baseDomainId,
    domain: ref.baseDomain,
    names: wildcardNamesOf(ref.baseDomain).join(','),
    status: 'ACTIVE',
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
  }, ['baseDomainId']));
  invalidateBaseCertificateCache(ref.baseDomain);
}

/** A failed wildcard order: attempts, the sanitised reason and the next try. A held certificate stays ACTIVE and keeps being served. */
export async function recordBaseOrderFailure(ref: BaseRef, failure: OrderFailure, now: Date = new Date(), directoryUrl: string | null = null): Promise<{ attempts: number; retryAt: Date }> {
  return withSystemRLS(async (qr) => {
    const repo = qr.manager.getRepository(TenantDomainBaseDomainCertificate);
    const row = await repo.findOne({ where: { baseDomainId: ref.baseDomainId } });
    const attempts = (row?.attempts ?? 0) + 1;
    const wait = failure.rateLimited ? Math.max(failure.retryAfterMs ?? 0, RATE_LIMIT_MIN_BACKOFF_MS) : backoffMs(attempts);
    const retryAt = new Date(now.getTime() + wait);
    const fields = {
      attempts,
      lastError: sanitizeOrderError(failure.message),
      lastAttemptAt: now,
      retryAt,
      status: ownCertificate(row, ref.baseDomain, directoryUrl)?.certPem ? 'ACTIVE' : 'FAILED',
    };
    if (row) await repo.update({ baseDomainId: ref.baseDomainId }, fields);
    else await repo.insert({ baseDomainId: ref.baseDomainId, domain: ref.baseDomain, names: wildcardNamesOf(ref.baseDomain).join(','), ...fields });
    return { attempts, retryAt };
  });
}

/** What the root tenant's Base domains page shows of a wildcard (D349): named columns only, never the chain or the key. */
export interface BaseCertificateSummary {
  state: 'none' | 'ordering' | 'held' | 'failed';
  names: string[];
  notAfter: string | null;
  renewAfter: string | null;
  lastError: string | null;
  retryAt: string | null;
}

export function summarizeBaseCertificate(row: TenantDomainBaseDomainCertificate | null, baseDomain: string, directoryUrl: string | null): BaseCertificateSummary {
  const own = ownCertificate(row, baseDomain, directoryUrl);
  const held = !!own?.certPem && !!own.notAfter && own.notAfter.getTime() > Date.now();
  const state: BaseCertificateSummary['state'] = held ? 'held' : !own ? 'none' : own.status === 'FAILED' ? 'failed' : 'ordering';
  return {
    state,
    names: own?.names ? own.names.split(',').filter(Boolean) : wildcardNamesOf(baseDomain),
    notAfter: held ? own!.notAfter!.toISOString() : null,
    renewAfter: held && own!.renewAfter ? own!.renewAfter.toISOString() : null,
    lastError: own?.lastError ?? null,
    retryAt: own?.retryAt ? own.retryAt.toISOString() : null,
  };
}

/**
 * The wildcards the platform holds now, by base domain name, for the transition of phase 56 (D348): only ACTIVE bases, only this directory's
 * unexpired rows; the dates only, never the chain or the key. Cached 60 s in process.
 */
export interface HeldWildcard { baseDomain: string; notAfter: Date; issuedAt: Date | null }
export type HeldWildcards = Map<string, HeldWildcard>;
let heldCache: { at: number; value: HeldWildcards } | null = null;

export async function heldWildcards(): Promise<HeldWildcards> {
  if (heldCache && Date.now() - heldCache.at < HIT_TTL_MS) return heldCache.value;
  const out: HeldWildcards = new Map();
  const directory = acmeConfig()?.directoryUrl ?? null;
  for (const b of (await baseDomainList()).filter((x) => x.status === 'ACTIVE' && x.baseDomainId)) {
    const own = ownCertificate(await findBaseCertificate(b.baseDomainId as string).catch(() => null), b.baseDomain, directory);
    if (own?.certPem && own.notAfter && own.notAfter.getTime() > Date.now()) out.set(b.baseDomain, { baseDomain: b.baseDomain, notAfter: own.notAfter, issuedAt: own.issuedAt ?? null });
  }
  heldCache = { at: Date.now(), value: out };
  return out;
}

/** The held wildcard that serves `host` (one label under an ACTIVE base whose wildcard is held), or null. */
export function wildcardServing(host: string, held: HeldWildcards): HeldWildcard | null {
  const cover = wildcardCoverOf(host, [...held.keys()]);
  return cover ? held.get(cover) ?? null : null;
}

/**
 * D348: a per-name certificate of a host its base's wildcard serves is retired once the daily probe has seen the wildcard on the host (the
 * expiry it read is the wildcard's, read after the wildcard was issued) and the wildcard has been held for 24 hours.
 */
export const RETIRE_AFTER_MS = 24 * 3_600_000;
export function mayRetirePerName(
  probe: { sslExpiresAt?: Date | string | null; sslLastCheckedAt?: Date | string | null },
  wildcard: HeldWildcard,
  now: Date,
): boolean {
  if (!wildcard.issuedAt || now.getTime() - wildcard.issuedAt.getTime() < RETIRE_AFTER_MS) return false;
  if (!probe.sslExpiresAt || !probe.sslLastCheckedAt) return false;
  const seenAt = new Date(probe.sslLastCheckedAt).getTime();
  const seenExpiry = new Date(probe.sslExpiresAt).getTime();
  return seenAt > wildcard.issuedAt.getTime() && Math.abs(seenExpiry - wildcard.notAfter.getTime()) < 2_000;
}
