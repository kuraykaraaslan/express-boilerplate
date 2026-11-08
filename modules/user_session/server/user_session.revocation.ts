import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { userSessionSessionRevokedLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/user_session.session_revoked';

/** Extension point id — declared in user_session/module.json `extensionPoints`. */
export const SESSION_REVOKED_POINT = 'user_session:session_revoked';

export interface RevokedSession {
  userSessionId: string;
  userId: string;
  tenantId: string;
  /**
   * D249: the modules whose session-ending orders for this session were already recorded in the revoking transaction
   * (`session_end:order_source`, `user_session.revocation-tx.ts`). A hook of such a module skips the session; absent on a path that
   * records nothing in its transaction, and for a module whose orders the transaction could not take.
   */
  sessionEndOrderedBy?: string[];
}

/**
 * `user_session:session_revoked` — told after sessions are deleted (logout, "sign out other
 * devices", "log out everywhere", password change, account deletion).
 *
 * For data that was bound to a session and must not outlive it: a native app's push token,
 * which otherwise keeps delivering the account's notifications to a phone nobody is signed in
 * on. Default export of a contribution: `(revoked: RevokedSession[]) => Promise<void>`.
 *
 * Sessions that merely EXPIRE are not announced here (nothing deletes them eagerly).
 */
export type SessionRevokedHook = (revoked: RevokedSession[]) => Promise<void>;

/**
 * Best-effort by contract: a hook that throws is logged and skipped, and one that has not
 * answered within the point's `timeoutMs` (2 s, user_session/module.json) is no longer awaited.
 * Revoking a session is a security action and must never fail, or be delayed indefinitely (an
 * offline Redis queues a publish rather than failing it), because a satellite's cleanup had trouble.
 *
 * Told per workspace: one revocation ("log out everywhere") can span several, and a hook of a
 * module that is not active in a workspace is not told about that workspace's sessions.
 */
export async function notifySessionsRevoked(revoked: RevokedSession[]): Promise<void> {
  if (revoked.length === 0) return;
  const byTenant = new Map<string, RevokedSession[]>();
  for (const session of revoked) byTenant.set(session.tenantId, [...(byTenant.get(session.tenantId) ?? []), session]);
  await Promise.all([...byTenant].map(async ([tenantId, sessions]) => {
    // common.29: a hook that failed or was abandoned is no longer only logged: the notification goes to the durable outbox
    // and the outbox worker replays it until every hook answers.
    let failed: string[];
    let error: string | undefined;
    try {
      failed = await fanOutRevoked(tenantId, sessions);
    } catch (err) {
      failed = ['*'];
      error = err instanceof Error ? err.message : String(err);
    }
    if (failed.length) {
      const { recordRevocationRetry } = await import('./user_session.revocation.outbox');
      await recordRevocationRetry(tenantId, sessions, failed, error);
    }
  }));
}

/** One workspace's fan-out; answers the ids of the contributions that failed (threw, timed out, quarantined). */
export async function fanOutRevoked(tenantId: string, sessions: RevokedSession[]): Promise<string[]> {
  const out = await ext.fanOut<SessionRevokedHook>(
    SESSION_REVOKED_POINT, tenantCtx(tenantId), userSessionSessionRevokedLoaders,
    (hook) => hook(sessions),
  );
  return (out?.failed ?? []).map((f) => f.contributionId);
}
