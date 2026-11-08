import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { TenantDomain } from './entities/tenant_domain.entity';
import { TenantDomainCertificate } from './entities/tenant_domain_certificate.entity';
import TenantDomainMessages from './tenant_domain.messages';
import { acmeConfig } from './tenant_domain.acme.config';
import { certificateAction, ownCertificate } from './tenant_domain.certificates.policy';
import { isCertEligibleDomain } from './tenant_domain.serving';
import { managedBases } from './tenant_domain.base-domains';
import { isProbeableHost } from './ssl_provisioning.probe';

/**
 * What the domain page may know about the certificate the platform holds (phase 51.4). Never the PEM chain, never the key: the columns
 * are listed, not `select *`, so a later column cannot leak through here by being added to the entity.
 */
export interface CertificateSummary {
  /** The platform orders this installation's certificates itself (ACME_DIRECTORY_URL is set). */
  managed: boolean;
  /** NONE: no row. PENDING: wanted or ordering. ACTIVE: held. FAILED: the last order failed and nothing is held. */
  status: 'NONE' | 'PENDING' | 'ACTIVE' | 'FAILED';
  notBefore: Date | null;
  notAfter: Date | null;
  renewAfter: Date | null;
  attempts: number;
  lastError: string | null;
  lastAttemptAt: Date | null;
  retryAt: Date | null;
  /** Phase 56 (D349): the host is served with its base domain's wildcard (`*.roltek.xyz`); the dates are the wildcard's. */
  coveredBy?: string;
}

export async function certificateSummary(tenantId: string, tenantDomainId: string, domain: string): Promise<CertificateSummary | null> {
  const managed = acmeConfig() !== null;
  // Phase 56 (D349): a platform subdomain under an ACTIVE base whose wildcard is held is served with that wildcard (tls-cert answers it
  // first): the page says so, with the wildcard's dates, never its chain or key.
  const wildcard = await wildcardSummaryFor(domain).catch(() => null);
  if (wildcard) return wildcard;
  const row = await withTenantRepositoryFor(tenantId, TenantDomainCertificate, (repo) => repo.findOne({
    where: { tenantDomainId, tenantId },
    select: ['certificateId', 'domain', 'directoryUrl', 'status', 'notBefore', 'notAfter', 'renewAfter', 'attempts', 'lastError', 'lastAttemptAt', 'retryAt'],
  }));
  // A row of a former name of a renamed free subdomain, or one another authority's directory issued (staging), is not this host's certificate.
  const own = ownCertificate(row, domain, acmeConfig()?.directoryUrl ?? null);
  if (!own && !managed) return null;
  return {
    managed,
    status: own ? (own.status as CertificateSummary['status']) : 'NONE',
    notBefore: own?.notBefore ?? null,
    notAfter: own?.notAfter ?? null,
    renewAfter: own?.renewAfter ?? null,
    attempts: own?.attempts ?? 0,
    lastError: own?.lastError ?? null,
    lastAttemptAt: own?.lastAttemptAt ?? null,
    retryAt: own?.retryAt ?? null,
  };
}

export interface CheckRequested { queued: { issue: boolean; probe: true } }

/**
 * "Force SSL check" on a platform-managed installation (phase 51.4): nothing is probed inside the request. A handshake probe goes on the
 * certificate queue, and so does an order when the domain holds no good certificate (a back-off is ignored: a person asked). The same
 * refusals as the inline probe: 404 unknown, 422 not probeable, 409 not servable.
 */
export async function requestCertificateCheck(tenantId: string, tenantDomainId: string): Promise<CheckRequested> {
  const row = await withTenantRepositoryFor(tenantId, TenantDomain, (repo) => repo.findOne({ where: { tenantDomainId, tenantId } }));
  if (!row) throw new AppError(TenantDomainMessages.DOMAIN_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  if (!isProbeableHost(row.domain)) throw new AppError(TenantDomainMessages.SSL_CHECK_NOT_PROBEABLE, 422, ErrorCode.VALIDATION_ERROR);
  if (!isCertEligibleDomain(row, await managedBases())) throw new AppError(TenantDomainMessages.SSL_CHECK_NOT_VERIFIED, 409, ErrorCode.CONFLICT);

  const cert = await withTenantRepositoryFor(tenantId, TenantDomainCertificate, (repo) => repo.findOne({ where: { tenantDomainId, tenantId } }));
  const held = ownCertificate(cert, row.domain, acmeConfig()?.directoryUrl ?? null);
  const { enqueueIssue, enqueueProbe } = await import('./tenant_domain.certificates.job');
  const wantsOrder = certificateAction(held, new Date(), true) !== 'none';
  if (wantsOrder) await enqueueIssue({ tenantId, tenantDomainId, domain: row.domain.toLowerCase() }, { force: true });
  await enqueueProbe({ tenantId, tenantDomainId }, wantsOrder ? 60_000 : 0);
  return { queued: { issue: wantsOrder, probe: true } };
}

async function wildcardSummaryFor(domain: string): Promise<CertificateSummary | null> {
  const [{ baseDomainList }, svc] = await Promise.all([import('./tenant_domain.base-domains'), import('./tenant_domain.base-certificates.service')]);
  const base = svc.coveringBase(domain, await baseDomainList());
  if (!base?.baseDomainId) return null;
  const own = ownCertificate(await svc.findBaseCertificate(base.baseDomainId), base.baseDomain, acmeConfig()?.directoryUrl ?? null);
  if (!own?.certPem || !own.notAfter || own.notAfter.getTime() <= Date.now()) return null;
  return {
    managed: true, status: 'ACTIVE', notBefore: own.notBefore ?? null, notAfter: own.notAfter, renewAfter: own.renewAfter ?? null,
    attempts: own.attempts ?? 0, lastError: own.lastError ?? null, lastAttemptAt: own.lastAttemptAt ?? null, retryAt: own.retryAt ?? null,
    coveredBy: `*.${base.baseDomain}`,
  };
}

