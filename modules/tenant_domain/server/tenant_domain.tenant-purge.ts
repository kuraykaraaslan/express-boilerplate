import type { TenantPurgeStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { withSharedTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { invalidateCertificateCache } from './tenant_domain.certificates.service';

/**
 * `tenant:purge_step` contribution (phase 51): a purged tenant leaves no certificate and no private key behind, and its hosts stop being
 * answered to the TLS terminator at once (this process's cache is dropped; the others catch up within the cache TTL). In the tenant's
 * shared-database context, in one transaction. Idempotent: a second run finds nothing.
 */
export const PURGE_STATEMENTS = [
  'DELETE FROM "tenant_domain_certificates" WHERE "tenantId" = $1',
  // phase 56 (D347): the purged tenant's old hosts stop redirecting.
  'DELETE FROM "tenant_domain_host_moves" WHERE "tenantId" = $1',
] as const;

const step: TenantPurgeStep = {
  async purge(tenantId: string): Promise<void> {
    await withSharedTenantTransactionFor(tenantId, async (qr) => {
      for (const sql of PURGE_STATEMENTS) await qr.query(sql, [tenantId]);
    });
    invalidateCertificateCache();
  },
};

export default step;
