import redis from "@kuraykaraaslan-labs/redis";
import Logger from "@kuraykaraaslan-labs/logger";
import { getDataSource } from "@kuraykaraaslan-labs/db";
import { UserSession as UserSessionEntity } from "./entities/user_session.entity";
import { sessionCacheKey, userCacheKey } from "./user_session.cache-keys";

/**
 * Purging a user's cached sessions by exact key.
 *
 * This used to run `KEYS session:<userId>:*`, which walks the whole keyspace on Redis's single thread, on every token
 * refresh, logout and revoke. Every cache key is derivable instead: the session row stores the same access-token hash
 * the key is made of (see user_session.cache-keys.ts), so callers pass the hashes of the rows they touch, read BEFORE
 * those rows are updated or deleted, and all the keys go in one UNLINK.
 */
/**
 * Cache keys whose purge failed (auth.21). A purge runs after the database already rotated or revoked the session, so a refused
 * UNLINK left the OLD access token's cache entry alive for its whole TTL, and the session reader trusts that entry before the
 * database. The keys wait here and are purged again before the next cached session read of this process (`flushPendingPurges`).
 * Process-local: another instance that holds the same stale entry still trusts it until its TTL.
 */
const pendingPurges = new Set<string>();

export default class UserSessionCacheService {
  /** Retry the purges that failed; called before a cached session is trusted. Never throws; keys that fail again stay queued. */
  static async flushPendingPurges(): Promise<void> {
    if (pendingPurges.size === 0) return;
    const keys = [...pendingPurges];
    try {
      await redis.unlink(...keys);
      for (const k of keys) pendingPurges.delete(k);
    } catch {
      // still unreachable: keep them for the next read
    }
  }

  /** Test seam: how many purges are still owed. */
  static pendingPurgeCount(): number {
    return pendingPurges.size;
  }

  /**
   * Drop the cache entries of the given sessions of `userId` (by stored access-token hash), plus the user's cached
   * profile (`session:<userId>:user`), in one UNLINK. Failures are logged and swallowed, as before: the revoke that
   * called this has already happened in the database.
   */
  static async clearSessionCacheKeys(userId: string, accessTokenHashes: ReadonlyArray<string | null | undefined>): Promise<void> {
    const keys = [
      ...new Set(accessTokenHashes.filter((h): h is string => !!h).map((h) => sessionCacheKey(userId, h))),
      userCacheKey(userId),
    ];
    try {
      await redis.unlink(...keys);
    } catch {
      Logger.error(`Failed to clear session cache for user ${userId}; the purge is retried before the next cached session read`);
      for (const k of keys) pendingPurges.add(k);
    }
  }

  /**
   * Drop the cache entries of every session `userId` still has in the database. A caller that is about to delete or
   * rewrite rows reads their hashes first and uses clearSessionCacheKeys instead: once the rows are gone, so are the
   * hashes this would find.
   */
  static async clearUserSessionCache(userId: string): Promise<void> {
    let hashes: string[] = [];
    try {
      const ds = await getDataSource();
      const rows = await ds.getRepository(UserSessionEntity).find({ where: { userId }, select: { accessToken: true } });
      hashes = rows.map((r) => r.accessToken);
    } catch {
      Logger.error(`Failed to list sessions to clear the cache of user ${userId}`);
    }
    await UserSessionCacheService.clearSessionCacheKeys(userId, hashes);
  }
}
