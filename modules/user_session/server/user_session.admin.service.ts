import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { UserSession as UserSessionEntity } from './entities/user_session.entity';
import type { ListedUserSession, SessionMeta } from './user_session.types';
import UserSessionMessages from './user_session.messages';
import UserSessionCacheService from './user_session.cache.service';
import UserSessionCrudService from './user_session.crud.service';
import { revokeSessions } from './user_session.revocation-tx';
import { sessionNeedsStepUp } from './user_session.step-up-flag';

/**
 * Phase 55 00.6 (P-6): what an administrator (or, later, the firewall) does to ANOTHER person's live sessions. The account page's
 * own actions ("sign out this session", "sign out all other sessions") stay in user_session.crud.service; these differ in who acts:
 * the audit row names the acting administrator (or none for the firewall) and the source, never the person.
 *
 *  - `revokeUserSessionsByAdmin`: every session of the person (platform), or only those of one workspace (a tenant administrator).
 *  - `revokeUserSessionByAdmin`: one session (the firewall's "end this session" rung).
 *  - `forceSessionStepUp` / `clearSessionStepUp`: the session keeps living but every request is refused 401 with `details.stepUp`
 *    until the person proves a second factor on it (user_session.step-up-flag.ts); the undo lifts it.
 *  - `flagPasswordChangeRequired`: every live session of the person must change the password before anything else works
 *    (the existing auth.05 step); `mustChangePassword` on user_security makes the next sign-in do the same.
 *
 * Callers own the authorization and the ranks (who may act on whom): these only act and audit. A firewall caller passes
 * `actorId: null, source: 'firewall'` (candidate actions listed in docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.6).
 */

export type SessionActionSource = 'admin' | 'firewall';

export interface SessionActor {
  /** The administrator; null for the firewall or another system actor. */
  actorId: string | null;
  source?: SessionActionSource;
  /** An operator's note, kept in the audit row only. */
  reason?: string | null;
}

type Row = Pick<UserSessionEntity, 'userSessionId' | 'userId' | 'tenantId' | 'accessToken'> & Partial<UserSessionEntity>;

const repo = async () => (await getDataSource()).getRepository(UserSessionEntity);

/** Not SESSION_NOT_FOUND: that message makes the browser client refresh its own token (axios REFRESHABLE_MESSAGES). */
const notFound = () => new AppError(UserSessionMessages.TARGET_SESSION_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

function audit(action: string, userId: string, actor: SessionActor, tenantId: string | null, metadata: Record<string, unknown>): void {
  AuditLogService.log({
    tenantId,
    actorId: actor.actorId,
    actorType: actor.actorId ? 'USER' : 'SYSTEM',
    action,
    resourceType: 'user',
    resourceId: userId,
    metadata: { source: actor.source ?? 'admin', reason: actor.reason ?? null, ...metadata },
  }).catch(() => {});
}

async function endRows(rows: Row[]): Promise<void> {
  if (!rows.length) return;
  // D249: the delete with the sessions' session-ending orders in one transaction; cache keys, delivery and the hooks after it
  await revokeSessions(async (qr) => {
    await qr.manager.getRepository(UserSessionEntity).delete(rows.map((s) => s.userSessionId));
    return rows;
  });
}

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whose session this is and which workspace it was minted for, or null when there is no such session (an id of another shape included).
 * The firewall's session actions (phase 55 01.6) act on a session by its id: they read its owner here, and a run for one tenant leaves a
 * session of another tenant alone.
 */
export async function sessionOwnerOf(userSessionId: string): Promise<{ userId: string; tenantId: string | null } | null> {
  if (typeof userSessionId !== 'string' || !SESSION_ID_RE.test(userSessionId)) return null;
  const row = await (await repo()).findOne({ where: { userSessionId }, select: { userSessionId: true, userId: true, tenantId: true } }) as Row | null;
  return row ? { userId: row.userId, tenantId: row.tenantId ?? null } : null;
}

/**
 * The ids of every session row of the person, whatever its status, expiry or idleness (phase 55, D55-18): an expired, revoked or idle
 * row still carries the user id until the prune job deletes it. Ids only. For the AI firewall's privacy erasure, which deletes the
 * events the person's sessions produced; the live list below hides the rows a sign-in would refuse.
 */
export async function sessionIdsOfUser(userId: string): Promise<string[]> {
  if (typeof userId !== 'string' || !userId) return [];
  const rows = await (await repo()).find({ where: { userId }, select: { userSessionId: true } }) as Array<Pick<UserSessionEntity, 'userSessionId'>>;
  return rows.map((r) => r.userSessionId).filter((id): id is string => typeof id === 'string' && id.length > 0);
}

/** The person's live sessions (not expired, not idle), newest first, as the account page lists them. */
export async function listSessionsForAdmin(userId: string): Promise<ListedUserSession[]> {
  return UserSessionCrudService.getUserSessions(userId);
}

/**
 * Ends the person's sessions: all of them (platform; pending second-factor sign-ins and impersonation sessions of the person
 * included), or, with `tenantId`, only those minted for that workspace (a tenant administrator ends nothing elsewhere).
 */
export async function revokeUserSessionsByAdmin(userId: string, actor: SessionActor & { tenantId?: string | null }): Promise<{ count: number }> {
  const r = await repo();
  const where = actor.tenantId ? { userId, tenantId: actor.tenantId } : { userId };
  const rows = await r.find({ where, select: { userSessionId: true, userId: true, tenantId: true, accessToken: true } }) as Row[];
  await endRows(rows);
  audit(AuditActions.USER_SESSIONS_REVOKED_ADMIN, userId, actor, actor.tenantId ?? null, {
    scope: actor.tenantId ? 'tenant' : 'all', count: rows.length, sessionIds: rows.map((s) => s.userSessionId).slice(0, 50),
  });
  return { count: rows.length };
}

/** Ends one session of the person. 404 when the person has no such session. */
export async function revokeUserSessionByAdmin(userId: string, userSessionId: string, actor: SessionActor): Promise<void> {
  const r = await repo();
  const row = await r.findOne({ where: { userSessionId, userId } }) as Row | null;
  if (!row) throw notFound();
  await endRows([row]);
  audit(AuditActions.USER_SESSIONS_REVOKED_ADMIN, userId, actor, null, { scope: 'session', count: 1, sessionIds: [userSessionId], sessionTenantId: row.tenantId });
}

/**
 * Asks one live session of the person to prove a second factor again. Refused (409) for a session that cannot step up: an
 * impersonation or break-glass session (the person at the keyboard is not the account owner, `assertNotImpersonating`) and a
 * sign-in still waiting for its second factor (it is already being asked). Asking again while it is still asked changes
 * nothing and writes nothing (`alreadyRequired`). Whether the person HAS a factor that can step up is the caller's check
 * (auth's `stepUpAvailableFor`): without one the session could only sign out.
 */
export async function forceSessionStepUp(userId: string, userSessionId: string, actor: SessionActor): Promise<{ alreadyRequired: boolean; at: string }> {
  const r = await repo();
  const row = await r.findOne({ where: { userSessionId, userId } }) as Row | null;
  if (!row || (row.sessionExpiry && new Date(row.sessionExpiry) < new Date())) throw notFound();
  const meta = (row.metadata ?? {}) as SessionMeta;
  if (meta.impersonation || meta.breakGlass || row.otpVerifyNeeded) {
    throw new AppError(UserSessionMessages.SESSION_STEP_UP_NOT_APPLICABLE, 409, ErrorCode.CONFLICT);
  }
  if (meta.stepUpRequired) return { alreadyRequired: true, at: meta.stepUpRequired.at };
  const at = new Date().toISOString();
  const metadata: SessionMeta = { ...meta, stepUpRequired: { at, source: actor.source ?? 'admin' } };
  await r.update({ userSessionId }, { metadata: metadata as never });
  // The guard reads the flag from the cached session: the cached copy goes, so the very next request reads the row.
  await UserSessionCacheService.clearSessionCacheKeys(userId, [row.accessToken]);
  audit(AuditActions.USER_SESSION_STEP_UP_FORCED, userId, actor, null, { userSessionId, sessionTenantId: row.tenantId });
  return { alreadyRequired: false, at };
}

/**
 * Lifts a forced step-up: by an administrator (the undo, `cause: 'admin'`) or because the person proved a factor on the
 * session (`cause: 'step_up'`, auth.step-up.service `finishStepUp`). Answers whether one was lifted; only then is it audited.
 * With `userId`, the session must be that person's (404 otherwise); the step-up path passes none (it is the caller's own session).
 */
export async function clearSessionStepUp(
  userSessionId: string,
  actor: SessionActor & { cause: 'admin' | 'step_up'; userId?: string },
): Promise<{ wasRequired: boolean }> {
  const r = await repo();
  const row = await r.findOne({ where: actor.userId ? { userSessionId, userId: actor.userId } : { userSessionId } }) as Row | null;
  if (!row) {
    if (actor.userId) throw notFound();
    return { wasRequired: false };
  }
  if (!sessionNeedsStepUp(row)) return { wasRequired: false };
  const { stepUpRequired: _lifted, ...rest } = (row.metadata ?? {}) as SessionMeta;
  void _lifted;
  await r.update({ userSessionId }, { metadata: rest as never });
  await UserSessionCacheService.clearSessionCacheKeys(row.userId, [row.accessToken]);
  audit(AuditActions.USER_SESSION_STEP_UP_CLEARED, row.userId, actor, null, {
    userSessionId, cause: actor.cause, sessionTenantId: row.tenantId, ...(actor.cause === 'step_up' ? { source: 'self' } : {}),
  });
  return { wasRequired: true };
}

/**
 * auth.05 on the live sessions too: each session of the person (impersonation and break-glass sessions aside, which are not the
 * person's own and are refused a password change) is refused everything but the change-password step until the password is
 * changed, which clears the flag (`clearPasswordChangeRequired`). Answers how many sessions were flagged.
 */
export async function flagPasswordChangeRequired(userId: string): Promise<number> {
  const r = await repo();
  const rows = await r.find({ where: { userId } }) as Row[];
  const flagged: Row[] = [];
  for (const row of rows) {
    const meta = (row.metadata ?? {}) as SessionMeta;
    if (meta.impersonation || meta.breakGlass || meta.passwordChangeRequired === true) continue;
    await r.update({ userSessionId: row.userSessionId }, { metadata: { ...meta, passwordChangeRequired: true } as never });
    flagged.push(row);
  }
  if (flagged.length) await UserSessionCacheService.clearSessionCacheKeys(userId, flagged.map((s) => s.accessToken));
  return flagged.length;
}
