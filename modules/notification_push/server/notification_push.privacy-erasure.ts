import type { ErasureOutcome } from '@kuraykaraaslan-labs/common/server/common.privacy-contracts';
import type { PrivacySubject } from '@kuraykaraaslan-labs/common/server/common.privacy-contracts';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { PushSubscription as PushSubscriptionEntity } from './entities/push_subscription.entity';
import { clearCacheForUser } from './notification_push.config';

/**
 * `privacy:erasure` — a person's push registrations (browser endpoints and app tokens).
 *
 * They are addressing data and nothing else, so they are simply deleted: there is no
 * statutory reason to keep a token for a device that must no longer be notified, and
 * keeping one would leave the erased account's phone buzzing with a stranger's messages
 * if the token were ever re-bound.
 */
export async function erase(
  tenantId: string,
  subject: PrivacySubject,
  options: { dryRun: boolean },
): Promise<ErasureOutcome> {
  const userId = subject.identifiers?.userId ?? (subject.subjectType === 'USER' ? subject.subjectId : null);
  if (!userId) return { erased: 0, mode: 'ERASE' };

  const count = await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, async (repo) => {
    const n = await repo.count({ where: { tenantId, userId } });
    if (!options.dryRun && n > 0) await repo.delete({ tenantId, userId });
    return n;
  });
  if (!options.dryRun && count > 0) await clearCacheForUser(tenantId, userId);

  return { erased: count, mode: 'ERASE' };
}

const erasureProvider = { erase };
export default erasureProvider;
