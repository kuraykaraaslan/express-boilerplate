import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { UserSession as UserSessionEntity } from './entities/user_session.entity';
import UserSessionCacheService from './user_session.cache.service';
import { findIdleSessions } from './user_session.idle';

/**
 * D28: the housekeeping of the session table. Rows used to be deleted only by a sign-out, a revoke or the tenant cap, so a session that
 * simply expired or went dormant stayed for ever. `pruneSessions` deletes:
 *   - EXPIRED rows and DORMANT rows (user_session.idle.ts) once they are past the HISTORY RETENTION: the rows double as the person's
 *     sign-in history (the login-risk baseline reads the user's latest row; new-device recognition reads their past devices; the
 *     impersonation-sessions route lists past impersonations), so an ended session is kept for `HISTORY_RETENTION_DAYS`, and the user's
 *     newest `KEEP_NEWEST_PER_USER` rows are kept whatever their age (a person who comes back after a long absence is still "known").
 *     The list never shows an expired or dormant row, so keeping them costs the person nothing;
 *   - the same-device LEFTOVERS of before the device id: of the rows without a device id that share a user, tenant and device fingerprint
 *     (the same browser at the same address) only the newest stays; a row touched in the last `LEGACY_GRACE_HOURS` stays too (a second
 *     machine behind one office address with the same browser version is not a duplicate while it is in use). Impersonation and
 *     break-glass rows are neither candidates nor counted. Every new row has a device id, so this finds nothing once the old rows have gone.
 * Such sessions are already dead to the reader or replaced, so, as with every expiry, nobody is told (`user_session:session_revoked` is
 * for revocations) and no per-row audit is written; one log line carries the counts.
 */
export const HISTORY_RETENTION_DAYS = 90;
export const KEEP_NEWEST_PER_USER = 25;
export const LEGACY_GRACE_HOURS = 24;
const BATCH = 500;
const MAX_ROUNDS = 200;

type Gone = { userSessionId: string; userId: string; accessToken: string };
type Candidate = Gone & { tenantId: string; updatedAt: Date | null; createdAt: Date | null; sessionExpiry: Date; sessionStatus?: string };

async function dropCaches(rows: Gone[]): Promise<void> {
  const byUser = new Map<string, string[]>();
  for (const r of rows) byUser.set(r.userId, [...(byUser.get(r.userId) ?? []), r.accessToken]);
  for (const [userId, hashes] of byUser) await UserSessionCacheService.clearSessionCacheKeys(userId, hashes);
}

export type PruneResult = { expired: number; idle: number; legacy: number };

export async function pruneSessions({ now = Date.now() }: { now?: number } = {}): Promise<PruneResult> {
  const out: PruneResult = { expired: 0, idle: 0, legacy: 0 };
  const cutoff = new Date(now - HISTORY_RETENTION_DAYS * 24 * 3600 * 1000);

  // Ended rows past the retention, oldest first. A page's kept rows (a dormant row whose Redis key lives, a policy that could not be
  // read) stay at the front, so the offset moves by them. The Redis and policy questions are asked outside the transaction.
  let offset = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const page: Candidate[] = await withSystemRLS((qr) => qr.query(
      `SELECT "userSessionId", "userId", "tenantId", "accessToken", "updatedAt", "createdAt", "sessionExpiry", "sessionStatus" FROM (
         SELECT "userSessionId", "userId", "tenantId", "accessToken", "updatedAt", "createdAt", "sessionExpiry", "sessionStatus",
                row_number() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC) AS rn
         FROM "user_sessions"
       ) t
       WHERE rn > $1 AND ("sessionExpiry" < $2 OR "updatedAt" < $2)
       ORDER BY "createdAt" ASC, "userSessionId" ASC
       OFFSET $3 LIMIT $4`,
      [KEEP_NEWEST_PER_USER, cutoff, offset, BATCH],
    ));
    // Ended = past its expiry, or marked REVOKED / EXPIRED (seed and legacy rows can carry a future expiry with such a status; `getSession`
    // refuses them all the same). The retention clock of the latter is the row's own `updatedAt`, which the SQL above already applies.
    const expired = page.filter((r) => new Date(r.sessionExpiry).getTime() < cutoff.getTime() || (!!r.sessionStatus && r.sessionStatus !== 'ACTIVE'));
    const expiredIds = new Set(expired.map((r) => r.userSessionId));
    const rest = page.filter((r) => !expiredIds.has(r.userSessionId));
    const idle = await findIdleSessions(rest.map((r) => ({ ...r, updatedAt: r.updatedAt && new Date(r.updatedAt), createdAt: r.createdAt && new Date(r.createdAt) })), null, now);
    const gone = [...expired, ...rest.filter((r) => idle.has(r.userSessionId))];
    if (gone.length) await withSystemRLS((qr) => qr.manager.getRepository(UserSessionEntity).delete(gone.map((r) => r.userSessionId)));
    offset += page.length - gone.length;
    out.expired += expired.length;
    out.idle += gone.length - expired.length;
    await dropCaches(gone);
    if (page.length < BATCH) break;
  }

  // The same-device leftovers of before the device id (see above).
  const graceCutoff = new Date(now - LEGACY_GRACE_HOURS * 3600 * 1000);
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rows = await withSystemRLS(async (qr) => {
      const found: Gone[] = await qr.query(
        `SELECT "userSessionId", "userId", "accessToken" FROM (
           SELECT "userSessionId", "userId", "accessToken", "updatedAt",
                  row_number() OVER (PARTITION BY "userId", "tenantId", "deviceFingerprint" ORDER BY "createdAt" DESC) AS rn
           FROM "user_sessions"
           WHERE "deviceId" IS NULL AND "deviceFingerprint" IS NOT NULL
             AND ("metadata" IS NULL OR ("metadata" -> 'impersonation' IS NULL AND "metadata" -> 'breakGlass' IS NULL))
         ) t
         WHERE rn > 1 AND "updatedAt" < $1
         LIMIT ${BATCH}`,
        [graceCutoff],
      );
      if (found.length) await qr.manager.getRepository(UserSessionEntity).delete(found.map((r) => r.userSessionId));
      return found;
    });
    out.legacy += rows.length;
    await dropCaches(rows);
    if (rows.length < BATCH) break;
  }

  if (out.expired || out.idle || out.legacy) {
    Logger.info(`[user_session.prune] expired=${out.expired} idle=${out.idle} legacy_same_device=${out.legacy}`);
  }
  return out;
}
