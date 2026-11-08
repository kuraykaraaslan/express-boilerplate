import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type { RevokedSession } from '@kuraykaraaslan-labs/user_session/server/user_session.revocation';
import { PushSubscription as PushSubscriptionEntity } from './entities/push_subscription.entity';
import { clearCacheForUser } from './notification_push.config';

/**
 * `user_session:session_revoked` contribution — drop the native-app push tokens registered
 * under a session that no longer exists.
 *
 * Without it, signing out of the app left the token registered, and the device kept receiving
 * the account's notifications (a message preview on a lock screen nobody is signed in to).
 * Browser subscriptions carry no session id and are left alone: they belong to the browser.
 */
export default async function onSessionsRevoked(revoked: RevokedSession[]): Promise<void> {
  for (const { userSessionId, userId, tenantId } of revoked) {
    await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) =>
      repo.delete({ tenantId, userId, userSessionId }));
    await clearCacheForUser(tenantId, userId);
  }
}
