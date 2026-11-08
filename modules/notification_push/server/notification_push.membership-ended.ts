import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type { MembershipEnded } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.membership-ended';
import { PushSubscription as PushSubscriptionEntity } from './entities/push_subscription.entity';
import { clearCacheForUser } from './notification_push.config';

/**
 * `tenant_member:membership_ended` contribution — a person who is no longer an active member of a
 * workspace stops receiving that workspace's push notifications, browser or app.
 *
 * `sendToUser` addresses by user id and does not check membership (account-level notifications
 * are legitimately sent under the root tenant to people who are not members of it), so the
 * registrations themselves are what has to go. Re-activating a member does not bring them back:
 * the person registers again, which also re-asks for the OS permission.
 */
export default async function onMembershipEnded({ tenantId, userId }: MembershipEnded): Promise<void> {
  await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo.delete({ tenantId, userId }));
  await clearCacheForUser(tenantId, userId);
}
