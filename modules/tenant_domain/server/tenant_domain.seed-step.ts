import type { TenantSeedStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { ensureFreeSubdomain } from './tenant_domain.free-subdomain';
import type { TenantSeedHints } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';

/**
 * Auto-provision a new tenant's `<slug>.<wildcard>` subdomain so it routes immediately, without a manual admin step.
 * The subdomain lives under the platform's own wildcard TLS cert, so no DNS/ACME verification is needed: it is created
 * `ACTIVE` and primary. Idempotent; returns the domain it minted, or null.
 *
 * It used to live in `tenant`'s seedDefaults, which made tenant import this module (which requires it back). It runs
 * through `tenant:seed_step` now, last in the seeding as before (docs/phases/37-extensions/10, 2026-10-17 second pass).
 * Since the 2026-10-17 domains pass it is `ensureFreeSubdomain`, the same routine the slug-rename listener and the
 * reconcile sweep run, so a tenant created while minting failed gets its subdomain on the next sweep.
 */
export async function provisionWildcardSubdomain(tenantId: string, hints?: TenantSeedHints): Promise<string | null> {
  // Phase 56 (D346): the base the sign-up chose, if the root tenant lets organizations choose and it is on offer; else the default.
  const { acceptedNewTenantBase } = await import('./tenant_domain.base-domain-choice');
  const baseDomain = hints?.baseDomain ? await acceptedNewTenantBase(hints.baseDomain).catch(() => null) : null;
  const { domain, action } = await ensureFreeSubdomain(tenantId, { baseDomain, recordMove: false });
  return action === 'minted' ? domain : null;
}

/** `tenant:seed_step` contribution. A failure is thrown, so tenant's seeding report names it; it never fails the creation. */
const step: TenantSeedStep = {
  async seed(tenantId, hints) {
    try {
      await provisionWildcardSubdomain(tenantId, hints);
    } catch (err) {
      throw new Error(`wildcard subdomain: ${err instanceof Error ? err.message : String(err)}`);
    }
  },
};

export default step;
