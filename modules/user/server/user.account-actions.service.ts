/**
 * Phase 55 00.6 (P-6): the platform's admin actuators on one person's account, behind /api/users/{id}/sessions,
 * /sessions/{sessionId}, /sessions/{sessionId}/step-up, /trusted-devices, /trusted-devices/{deviceId} and /must-change-password.
 *
 * Each loads the person, applies the ranks (`assertMayActOnAccount`: never oneself, never an erased account, a root OWNER's or a
 * platform admin's only by an ACTIVE root OWNER) and calls the owning module, which writes the audit row naming the acting
 * administrator. The routes do the permission, the strict step-up of the acting administrator and the body.
 *
 * These are the platform half of the firewall's middle rungs (end a session, end all sessions, step-up, trusted devices, a
 * forced password change); the firewall will call the owning modules directly with `actorId: null, source: 'firewall'`.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import UserMessages from './user.messages';
import { assertMayActOnAccount, UserRefusalCode, UserRefusalError } from './user.admin-guard';

/**
 * `confirm`: the route's step-up of the acting administrator, run after the ranks (so a refused administrator burns no grant and
 * learns no more) and before the effect (a refused step-up changes nothing).
 */
type Actor = { actorId: string; reason?: string | null; confirm?: () => Promise<unknown> };

async function loadUser(userId: string) {
  const { getDataSource } = await import('@kuraykaraaslan-labs/db');
  const { User: UserEntity } = await import('./entities/user.entity');
  const user = await (await getDataSource()).getRepository(UserEntity).findOne({ where: { userId } });
  if (!user) throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  return user;
}

const sessions = () => import('@kuraykaraaslan-labs/user_session/server/user_session.admin.service');
const security = async () => (await import('@kuraykaraaslan-labs/user_security/server/user_security.service')).default;

/** The person's live sessions. Reading is not acting: no rank check beyond the route's permission (and no erased-account refusal). */
export async function listAccountSessions({ userId }: { userId: string }) {
  await loadUser(userId);
  return (await sessions()).listSessionsForAdmin(userId);
}

/** Ends every session of the person, in every workspace. */
export async function revokeAccountSessions({ userId, actorId, reason, confirm }: { userId: string } & Actor): Promise<{ count: number }> {
  const user = await loadUser(userId);
  await assertMayActOnAccount({ actorId, target: user, what: 'sign out every session of' });
  await confirm?.();
  return (await sessions()).revokeUserSessionsByAdmin(userId, { actorId, reason: reason ?? null, source: 'admin' });
}

/** Ends one session of the person. */
export async function revokeAccountSession({ userId, sessionId, actorId, reason, confirm }: { userId: string; sessionId: string } & Actor): Promise<void> {
  const user = await loadUser(userId);
  await assertMayActOnAccount({ actorId, target: user, what: 'sign out a session of' });
  await confirm?.();
  await (await sessions()).revokeUserSessionByAdmin(userId, sessionId, { actorId, reason: reason ?? null, source: 'admin' });
}

/**
 * Asks one live session of the person to prove a second factor again. A person who has no factor that can step up (no
 * authenticator app; no passkey where the passkey method is active for the session's workspace) is refused 409
 * STEP_UP_UNAVAILABLE_FOR_USER: the session could only sign out, so ending it is the honest action.
 */
export async function forceAccountSessionStepUp({ userId, sessionId, actorId, reason, confirm }: { userId: string; sessionId: string } & Actor) {
  const user = await loadUser(userId);
  await assertMayActOnAccount({ actorId, target: user, what: 'ask for a step-up on a session of' });
  const s = await sessions();
  const listed = (await s.listSessionsForAdmin(userId)).find((row) => row.userSessionId === sessionId);
  if (listed) {
    const { stepUpAvailableFor } = await import('@kuraykaraaslan-labs/auth/server/auth.step-up.service');
    if (!(await stepUpAvailableFor(userId, listed.tenantId))) {
      throw new UserRefusalError(
        UserRefusalCode.STEP_UP_UNAVAILABLE_FOR_USER,
        'This person has no second factor that can confirm a step-up. End the session instead.',
        409,
      );
    }
  }
  await confirm?.();
  // An unlisted id (another person's, expired or idle) is the service's 404.
  return s.forceSessionStepUp(userId, sessionId, { actorId, reason: reason ?? null, source: 'admin' });
}

/** Lifts a forced step-up (the undo). Answers whether one was lifted. */
export async function clearAccountSessionStepUp({ userId, sessionId, actorId, reason, confirm }: { userId: string; sessionId: string } & Actor) {
  const user = await loadUser(userId);
  await assertMayActOnAccount({ actorId, target: user, what: 'lift a step-up on a session of' });
  await confirm?.();
  return (await sessions()).clearSessionStepUp(sessionId, { userId, actorId, reason: reason ?? null, source: 'admin', cause: 'admin' });
}

export async function listAccountTrustedDevices({ userId }: { userId: string }) {
  await loadUser(userId);
  return (await security()).listTrustedDevices(userId);
}

/** Revokes one trusted device of the person (`deviceId`) or all of them. Their next sign-in there asks for the code again. */
export async function revokeAccountTrustedDevices({ userId, deviceId, actorId, reason, confirm }: { userId: string; deviceId?: string | null } & Actor) {
  const user = await loadUser(userId);
  await assertMayActOnAccount({ actorId, target: user, what: 'revoke the trusted devices of' });
  await confirm?.();
  return (await security()).revokeTrustedDevicesBy(userId, { by: 'admin', actorId, reason: reason ?? null }, deviceId ?? null);
}

async function audit(action: string, userId: string, actorId: string, metadata: Record<string, unknown>) {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
  await AuditLogService.log({ tenantId: null, actorId, actorType: 'USER', action, resourceType: 'user', resourceId: userId, metadata });
}

/**
 * The person must choose a new password: at the next sign-in (`mustChangePassword`) and on every live session now (each is
 * refused everything but the change-password step, auth.05). An account without a local password (a shadow user of a Fleet ID
 * node) is refused 409 NO_LOCAL_PASSWORD: it has nothing to change here.
 */
export async function forcePasswordChange({ userId, actorId, reason, confirm }: { userId: string } & Actor): Promise<{ sessionsFlagged: number }> {
  const user = await loadUser(userId);
  await assertMayActOnAccount({ actorId, target: user, what: 'force a password change on' });
  if (!user.password) {
    throw new UserRefusalError(UserRefusalCode.NO_LOCAL_PASSWORD, 'This account signs in without a local password, so there is no password to change.', 409);
  }
  await confirm?.();
  await (await security()).setMustChangePassword(userId, true);
  const sessionsFlagged = await (await sessions()).flagPasswordChangeRequired(userId);
  await audit(AuditActions.AUTH_PASSWORD_CHANGE_FORCED, userId, actorId, { sessionsFlagged, reason: reason ?? null, source: 'admin' });
  return { sessionsFlagged };
}

/**
 * Lifts a forced password change (the undo): the next sign-in and the live sessions no longer ask. A password that outlived
 * the policy's maximum age is asked for again at the next sign-in by the login itself.
 */
export async function unforcePasswordChange({ userId, actorId, reason, confirm }: { userId: string } & Actor): Promise<{ wasForced: boolean }> {
  const user = await loadUser(userId);
  await assertMayActOnAccount({ actorId, target: user, what: 'lift a forced password change on' });
  await confirm?.();
  const svc = await security();
  const wasForced = (await svc.getByUserId(userId)).mustChangePassword === true;
  await svc.setMustChangePassword(userId, false);
  const { default: UserSessionCrudService } = await import('@kuraykaraaslan-labs/user_session/server/user_session.crud.service');
  await UserSessionCrudService.clearPasswordChangeRequired(userId);
  await audit(AuditActions.AUTH_PASSWORD_CHANGE_UNFORCED, userId, actorId, { wasForced, reason: reason ?? null, source: 'admin' });
  return { wasForced };
}
