/**
 * Named support paths for locked-out people (docs/phases/38-security/06-authz-depth-and-rls.md 6.7; rule file: a clear support process
 * for locked accounts). Each is an explicit, permission-gated, audited operator action, never a side effect:
 *
 *  - `unlockAccount`: clears the failed-attempt counter and the lock (and the CAPTCHA counter), for somebody locked out by their own typos
 *    or by an attacker guessing their password.
 *  - `resetTwoFactor`: for somebody who lost their authenticator AND every backup code. It removes every second factor, ends every session and
 *    every trusted device, forces a NEW password at the next sign-in and marks the e-mail address unverified so it must be re-verified
 *    before the account works again (with e-mail verification required, the default). The person is told by a critical notice.
 *  - `securityLockAccount` / `securityUnlockAccount` (phase 55 00.1): the SECURITY lock, for an account that must not sign in at all
 *    (suspected takeover, an investigation). Unlike the guessing lock it refuses every sign-in method and ends the live sessions; the
 *    work is `UserSecurityService.lockAccount` / `unlockAccount` (user_security.lock.service.ts), these add the platform ranks.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import UserMessages from './user.messages';
import { assertMaySecurityLock } from './user.admin-guard';

/** `confirm` (phase 55 00.6): the route's step-up of the acting administrator, run after the refusals and before the effect. */
type Actor = { actorId: string; confirm?: () => Promise<unknown> };

async function loadUser(userId: string) {
  const { getDataSource } = await import('@kuraykaraaslan-labs/db');
  const { User: UserEntity } = await import('./entities/user.entity');
  const repo = (await getDataSource()).getRepository(UserEntity);
  const user = await repo.findOne({ where: { userId } });
  if (!user) throw new AppError(UserMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  return { repo, user };
}

async function audit(action: string, userId: string, actorId: string, metadata: Record<string, unknown>) {
  const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
  await AuditLogService.log({ tenantId: null, actorId, actorType: 'USER', action, resourceType: 'user', resourceId: userId, metadata });
}

export async function unlockAccount({ userId, actorId }: { userId: string } & Actor): Promise<{ wasLocked: boolean }> {
  const { user } = await loadUser(userId);
  const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
  const before = await UserSecurityService.getByUserId(userId);
  const wasLocked = !!before.lockedUntil && new Date(before.lockedUntil) > new Date();
  await UserSecurityService.updateUserSecurity(userId, { failedLoginAttempts: 0, lockedUntil: null as unknown as undefined });
  try {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    await redis.del(`auth:captcha-counter:${user.email.toLowerCase()}`);
  } catch { /* the counter expires on its own */ }
  await audit(AuditActions.AUTH_ACCOUNT_UNLOCKED_ADMIN, userId, actorId, { wasLocked, failedAttempts: before.failedLoginAttempts ?? 0 });
  return { wasLocked };
}

export async function resetTwoFactor({ userId, actorId, confirm }: { userId: string } & Actor): Promise<void> {
  if (userId === actorId) {
    throw new AppError('Reset your own second factor through the normal account flow.', 403, ErrorCode.FORBIDDEN);
  }
  const { repo, user } = await loadUser(userId);
  // A platform administrator's factors are never reset through this route: that is a break-glass decision made out of band.
  if (user.userRole === 'ADMIN') {
    throw new AppError('The second factor of a platform administrator cannot be reset here.', 403, ErrorCode.FORBIDDEN);
  }
  await confirm?.();
  const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
  const before = await UserSecurityService.getByUserId(userId);
  await UserSecurityService.updateUserSecurity(userId, {
    otpMethods: [], otpSecret: null as unknown as undefined, otpBackupCodes: [], mustChangePassword: true,
  });
  await UserSecurityService.revokeTrustedDevices(userId);
  await repo.update({ userId }, { emailVerifiedAt: null as unknown as undefined });
  const { default: UserSessionService } = await import('@kuraykaraaslan-labs/user_session/server/user_session.service');
  await UserSessionService.deleteAllSessions(userId);
  const { invalidate } = await import('./user.helpers');
  await invalidate({ userId, email: user.email });
  await audit(AuditActions.AUTH_2FA_RESET_ADMIN, userId, actorId, { methodsRemoved: before.otpMethods ?? [], emailReverificationRequired: true, passwordChangeRequired: true });
  // Phase 55 00 review: the factors are gone, so `security.mfa_disabled` (row and webhook) says so, as the event catalogue promises
  // ("by the user, or an administrator's reset"). On the ROOT tenant: the reset is a platform action, like its audit row. Only when a
  // factor was there to remove; best-effort (emitMfaChanged never throws).
  if ((before.otpMethods ?? []).length > 0 || before.otpSecret) {
    try {
      const { ROOT_TENANT_ID } = await import('@kuraykaraaslan-labs/common/server/tenant-constants');
      await UserSecurityService.emitMfaChanged(ROOT_TENANT_ID, userId, false, { method: 'ALL', by: 'admin' });
    } catch { /* the reset's own audit row is the durable record */ }
  }
  try {
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    const { ROOT_TENANT_ID } = await import('@kuraykaraaslan-labs/common/server/tenant-constants');
    const body = 'A support administrator reset the second factor on your account. You must verify your email address and choose a new password at your next sign-in. If you did not ask for this, contact support immediately.';
    await NotificationService.notifyCritical(
      ROOT_TENANT_ID, { userId, email: user.email },
      { event: 'auth.two_factor_reset', category: 'security', title: 'Two-factor authentication was reset on your account', body, data: { html: `<p>${body}</p>` } },
      { idempotencyKey: `two_factor_reset:${userId}:${new Date().toISOString().slice(0, 13)}` },
    );
  } catch { /* the audit row is the durable record */ }
}

export async function securityLockAccount({ userId, actorId, reason, until, confirm }: { userId: string; reason: string; until?: Date | null } & Actor) {
  const { user } = await loadUser(userId);
  await assertMaySecurityLock({ actorId, target: user });
  await confirm?.();
  const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
  const { lock } = await UserSecurityService.lockAccount(userId, { reason, until: until ?? null, actorId, source: 'admin' });
  return lock;
}

export async function securityUnlockAccount({ userId, actorId, reason, confirm }: { userId: string; reason?: string | null } & Actor): Promise<{ wasLocked: boolean }> {
  const { user } = await loadUser(userId);
  await assertMaySecurityLock({ actorId, target: user, lifting: true });
  await confirm?.();
  const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
  return UserSecurityService.unlockAccount(userId, { actorId, reason: reason ?? null, source: 'admin' });
}

export async function getSecurityLockState({ userId }: { userId: string }) {
  await loadUser(userId);
  const { default: UserSecurityService } = await import('@kuraykaraaslan-labs/user_security/server/user_security.service');
  return UserSecurityService.getSecurityLock(userId);
}
