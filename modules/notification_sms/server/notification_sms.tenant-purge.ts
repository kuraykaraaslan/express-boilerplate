import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type { TenantPurgeStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points';
import { NotificationSmsOptOut } from './entities/notification_sms_optout.entity';

/**
 * `tenant:purge_step` contribution (D254): a purged tenant's SMS opt-out rows (`notification_sms_optouts`, recipients' phone numbers) are deleted in
 * the tenant's own context. The cached states in Redis (`sms:optout:<tenantId>:…`) name the tenant and go with the purge's own Redis flush.
 * Idempotent: a second run finds nothing.
 */
export async function purgeSmsOptOutsOfTenant(tenantId: string): Promise<number> {
  const res = await withTenantRepositoryFor(tenantId, NotificationSmsOptOut, (repo) => repo.delete({ tenantId }));
  return res.affected ?? 0;
}

const step: TenantPurgeStep = {
  async purge(tenantId) {
    await purgeSmsOptOutsOfTenant(tenantId);
  },
};

export default step;
