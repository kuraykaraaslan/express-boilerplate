import 'reflect-metadata';
import type { QueryRunner } from 'typeorm';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { recordSessionEndInTx, type SessionEndInTx } from '@kuraykaraaslan-labs/session_end/server/session_end.in-tx';
import UserSessionCacheService from './user_session.cache.service';
import { notifySessionsRevoked, type RevokedSession } from './user_session.revocation';

/** What a revocation needs of each deleted row: whose session it was, where, and its token hash (the cache key). */
export interface RevocableRow {
  userSessionId: string;
  userId: string;
  tenantId: string;
  accessToken?: string | null;
}

/** Opens the transaction a revocation's delete runs in and hands its QueryRunner to `work`. */
export type RevocationTx = <T>(work: (qr: QueryRunner) => Promise<T>) => Promise<T>;

/**
 * The shared database with no tenant context, where every revocation deleted its rows before (`user_sessions` is a user-and-device
 * table, not tenant-isolated: a "log out everywhere" spans tenants). `session_end` sets each order's tenant for its own insert.
 */
export const sharedTx: RevocationTx = async (work) => (await getDataSource()).transaction((manager) => work(manager.queryRunner!));

/**
 * Ends sessions (D249, docs/audits/2026-11-03-redis-outage.md §3.2): `work` finds and deletes the rows inside ONE transaction and answers
 * the rows it deleted; before the commit their session-ending orders are recorded in that same transaction (`session_end:order_source`:
 * the websocket drops, so a crash right after the commit no longer leaves a revoked session's socket open). Then, in this order: the
 * cache keys of the sessions are cleared (a reconnect must not find the session cached as live), the orders are delivered (the fast
 * path; the relay has them otherwise), and `user_session:session_revoked` is told, each session carrying the modules whose orders are
 * already recorded (`sessionEndOrderedBy`, so their hooks skip it; a module whose orders the transaction could not take is not named,
 * and its hook records them after the commit as before, with the revocation outbox behind it).
 *
 * `tx` is the transaction to run in: the shared database (default), or the system context of a cross-tenant sweep. Answers the rows.
 */
export async function revokeSessions<R extends RevocableRow>(
  work: (qr: QueryRunner) => Promise<R[]>,
  tx: RevocationTx = sharedTx,
): Promise<R[]> {
  let pending = null as SessionEndInTx | null;
  const rows = await tx(async (qr) => {
    const deleted = await work(qr);
    if (deleted.length) {
      pending = await recordSessionEndInTx(qr, {
        type: 'sessions_revoked',
        sessions: deleted.map((r) => ({ tenantId: r.tenantId, userId: r.userId, userSessionId: r.userSessionId })),
      });
    }
    return deleted;
  });
  if (rows.length === 0) return rows;
  for (const userId of new Set(rows.map((r) => r.userId))) {
    await UserSessionCacheService.clearSessionCacheKeys(userId, rows.filter((r) => r.userId === userId).map((r) => r.accessToken));
  }
  await pending?.afterCommit();
  const revoked: RevokedSession[] = rows.map((r) => {
    const by = pending?.orderedBy(r.tenantId) ?? [];
    return { userSessionId: r.userSessionId, userId: r.userId, tenantId: r.tenantId, ...(by.length ? { sessionEndOrderedBy: by } : {}) };
  });
  await notifySessionsRevoked(revoked);
  return rows;
}
