import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';
import Logger from '@kuraykaraaslan-labs/logger';
import { TenantDomain } from './entities/tenant_domain.entity';
import { TenantDomainCertificate } from './entities/tenant_domain_certificate.entity';
import { isCertEligibleDomain, type BaseDomains } from './tenant_domain.serving';
import { managedBases } from './tenant_domain.base-domains';
import { mayRetirePerName, wildcardServing, type HeldWildcards } from './tenant_domain.base-certificates.service';
import { isProbeableHost } from './ssl_provisioning.probe';
import { certificateAction, ownCertificate } from './tenant_domain.certificates.policy';
import { acmeConfig } from './tenant_domain.acme.config';

/**
 * The twice-daily sweep (phase 51.3): every servable domain of every active tenant that holds no certificate, holds an expired one, or is
 * inside the renew-before window (and is not waiting out a back-off) is put on the certificate queue. It orders nothing itself. A domain
 * that was missed by the "became servable" hooks (created by a path that bypasses them, a reactivation, a restart in between) is picked
 * up here at the latest 12 hours later.
 */
export interface SweepResult {
  considered: number; enqueued: number; waiting: number; fresh: number; skipped: number;
  /** Phase 56 (D348): hosts its base's held wildcard serves (never ordered for), and per-name certificates retired after the wildcard served. */
  covered: number; retired: number;
}

export interface SweepDeps {
  now(): Date;
  /** The directory the installation orders from now, or null when it does not order. */
  directoryUrl(): string | null;
  tenants(): Promise<Array<{ tenantId: string }>>;
  domainsOf(tenantId: string): Promise<TenantDomain[]>;
  certificatesOf(tenantId: string): Promise<TenantDomainCertificate[]>;
  enqueue(ref: { tenantId: string; tenantDomainId: string; domain: string }): Promise<void>;
  /** The managed base domains (phase 56); default: the table's list. */
  bases?(): Promise<BaseDomains>;
  /** The wildcards held now (phase 56, D348); absent = none. */
  wildcards?(): Promise<HeldWildcards>;
  /** Deletes a per-name certificate its base's wildcard replaced (D348); absent = nothing is retired. */
  retire?(ref: { tenantId: string; tenantDomainId: string; domain: string }): Promise<void>;
}

const defaults: SweepDeps = {
  now: () => new Date(),
  directoryUrl: () => acmeConfig()?.directoryUrl ?? null,
  tenants: () => listActiveTenants(),
  domainsOf: (t) => withTenantRepositoryFor(t, TenantDomain, (repo) => repo.find({ where: { tenantId: t } })),
  certificatesOf: (t) => withTenantRepositoryFor(t, TenantDomainCertificate, (repo) => repo.find({ where: { tenantId: t } })),
  async enqueue(ref) {
    const { enqueueIssue } = await import('./tenant_domain.certificates.job');
    await enqueueIssue(ref);
  },
  async wildcards() {
    const { heldWildcards } = await import('./tenant_domain.base-certificates.service');
    return heldWildcards();
  },
  async retire(ref) {
    const { deleteCertificateOf } = await import('./tenant_domain.certificates.service');
    await deleteCertificateOf(ref);
    Logger.info(`[certificates] retired the per-name certificate of ${JSON.stringify(ref.domain)}: its base's wildcard serves it`);
  },
};

export async function sweepCertificates(deps: SweepDeps = defaults): Promise<SweepResult> {
  const result: SweepResult = { considered: 0, enqueued: 0, waiting: 0, fresh: 0, skipped: 0, covered: 0, retired: 0 };
  const directoryUrl = deps.directoryUrl();
  if (directoryUrl === null) return result;
  const now = deps.now();
  const wildcard = await (deps.bases ?? managedBases)();
  const held: HeldWildcards = deps.wildcards ? await deps.wildcards().catch(() => new Map()) : new Map();
  for (const tenant of await deps.tenants()) {
    try {
      const [domains, certs] = await Promise.all([deps.domainsOf(tenant.tenantId), deps.certificatesOf(tenant.tenantId)]);
      const byDomainId = new Map(certs.map((c) => [c.tenantDomainId, c]));
      for (const d of domains) {
        if (!isCertEligibleDomain(d, wildcard) || !isProbeableHost(d.domain)) { result.skipped++; continue; }
        result.considered++;
        const serving = wildcardServing(d.domain, held);
        if (serving) {
          result.covered++;
          const own = byDomainId.get(d.tenantDomainId);
          if (own && deps.retire && mayRetirePerName(d, serving, now)) {
            await deps.retire({ tenantId: d.tenantId, tenantDomainId: d.tenantDomainId, domain: d.domain.toLowerCase() });
            result.retired++;
          }
          continue;
        }
        const action = certificateAction(ownCertificate(byDomainId.get(d.tenantDomainId), d.domain, directoryUrl), now);
        if (action === 'none') result.fresh++;
        else if (action === 'wait') result.waiting++;
        else { await deps.enqueue({ tenantId: d.tenantId, tenantDomainId: d.tenantDomainId, domain: d.domain.toLowerCase() }); result.enqueued++; }
      }
    } catch (err) {
      // One tenant's failure must not stop the sweep for the rest: the next run tries it again.
      Logger.warn(`[certificates] sweep skipped tenant ${tenant.tenantId}: ${err instanceof Error ? err.message : 'unknown'}`);
    }
  }
  return result;
}
