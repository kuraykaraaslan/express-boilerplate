import redis from '@kuraykaraaslan-labs/redis';
import { revokedSessionKey } from './limiter.service';

/**
 * How long a revoked session stays marked: longer than any of its access tokens can still verify (`ACCESS_TOKEN_EXPIRES_IN`, an hour
 * unless an operator sets it).
 */
export const REVOKED_MARK_SECONDS = 24 * 60 * 60;

/**
 * `user_session:session_revoked` contribution (docs/phases/07-dashboard/40-data-traffic.md, D40-10(b)): marks each revoked session for
 * the limiter. The limiter reads a person from the access token's signature alone, with no database, so a token stolen and then
 * revoked would go on spending its person's bucket until it expires: the guard refuses it, but every session of that person meets 429.
 * A marked session's requests spend their address's own bucket, as anonymous ones do (`checkSignedIn`, limiter.service.ts).
 *
 * A Redis failure throws: the point then keeps the notification in its outbox and replays it (user_session.revocation.ts).
 */
export default async function onSessionsRevoked(revoked: Array<{ userSessionId?: string; userId: string; tenantId: string }>): Promise<void> {
  const ids = new Set<string>();
  for (const { userSessionId } of revoked) if (typeof userSessionId === 'string' && userSessionId) ids.add(userSessionId.toLowerCase());
  if (ids.size === 0) return;
  const tx = redis.multi();
  for (const id of ids) tx.set(revokedSessionKey(id), '1', 'EX', REVOKED_MARK_SECONDS);
  const results = await tx.exec();
  const failed = results?.find(([err]) => err);
  if (!results || failed) throw failed?.[0] ?? new Error('the revoked-session marks were not written');
}
