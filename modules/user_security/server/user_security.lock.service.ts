import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';
import { UserSecurity as UserSecurityEntity } from './entities/user_security.entity';
import UserSecurityMessages from './user_security.messages';
import { clearCache } from './user_security.helpers';
import { SecurityLockSourceEnum, type SecurityLock, type SecurityLockSource } from './user_security.types';

/**
 * The SECURITY lock of an account (docs/phases/55-ai-firewall/00-wire-existing-controls.md 0.1, P-1).
 *
 * Two locks, deliberately:
 *  - the guessing lock (`lockedUntil`, user_security.login.service.ts) is set by failed passwords and refuses the PASSWORD sign-in only,
 *    so a stranger guessing a password cannot lock a person out of their passkey, SSO or national ID;
 *  - the security lock (here) is set by an administrator or the firewall. It refuses EVERY sign-in method, because they all end in the
 *    one session-creation path (`UserSessionCrudService.createSession`, which calls `assertNotSecurityLocked`), and setting it ends every
 *    live session of the account.
 *
 * The lock is read from the database, never from the user_security cache: a lock that a stale cache entry walks past is not a lock.
 */

/** Longest note kept with a lock (the column is varchar(500)). */
export const SECURITY_LOCK_REASON_MAX = 500;

/**
 * Phase 55 02.6, the sign-up hold (auth's firewall action `auth.signup_hold`): a new account held until its e-mail is verified is a
 * security lock set by the firewall whose reason starts with this marker and names the run (`signup_hold:<proposalId>`). It refuses every
 * sign-in method like any security lock, but the person is told to verify their address (EMAIL_VERIFICATION_REQUIRED, which the sign-in
 * pages already explain), not that the account is locked; verifying the address lifts it (auth.verification.service.ts). An administrator's
 * unlock lifts it too.
 */
export const SIGNUP_HOLD_REASON_PREFIX = 'signup_hold:';

/** The reason of the sign-up hold a run sets. */
export const signupHoldReason = (runId: string): string => `${SIGNUP_HOLD_REASON_PREFIX}${runId}`;

/** Is this lock a sign-up hold (the firewall's, with the marker)? */
export const isSignupHold = (lock: Pick<SecurityLock, 'source' | 'reason'> | null | undefined): boolean =>
  !!lock && lock.source === 'firewall' && typeof lock.reason === 'string' && lock.reason.startsWith(SIGNUP_HOLD_REASON_PREFIX);

type LockRow = Pick<UserSecurityEntity, 'securityLockedAt' | 'securityLockedUntil' | 'securityLockReason' | 'securityLockedBy' | 'securityLockSource'>;

function asDate(v: unknown): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The lock a row carries while it holds, else null (never set, unlocked, or its `until` has passed). */
export function activeLockOf(row: Partial<LockRow> | null | undefined, now: Date = new Date()): SecurityLock | null {
  const lockedAt = asDate(row?.securityLockedAt);
  if (!row || !lockedAt) return null;
  const until = asDate(row.securityLockedUntil);
  if (until && until.getTime() <= now.getTime()) return null;
  const source = SecurityLockSourceEnum.safeParse(row.securityLockSource);
  return {
    lockedAt,
    until,
    reason: row.securityLockReason ?? '',
    actorId: row.securityLockedBy ?? null,
    source: source.success ? source.data : 'admin',
  };
}

/** The account's security lock while it holds, read from the database. */
export async function getSecurityLock(userId: string): Promise<SecurityLock | null> {
  const ds = await getDataSource();
  const row = await ds.getRepository(UserSecurityEntity).findOne({ where: { userId } });
  return activeLockOf(row as Partial<LockRow> | null);
}

export async function isSecurityLocked(userId: string): Promise<boolean> {
  return (await getSecurityLock(userId)) !== null;
}

/**
 * The sign-in gate: throws 403 ACCOUNT_SECURITY_LOCKED while the account is security-locked, and records the refused sign-in
 * (`auth.login_failed`, reason ACCOUNT_SECURITY_LOCKED). Called by createSession before anything else happens (no token, no session
 * row, no other session ended). A read that fails throws too: the session would not be issued (fail closed).
 */
export async function assertNotSecurityLocked(
  userId: string,
  ctx: { tenantId?: string | null; ipAddress?: string | null; userAgent?: string | null; method?: string | null } = {},
): Promise<void> {
  const lock = await getSecurityLock(userId);
  if (!lock) return;
  const hold = isSignupHold(lock);
  AuditLogService.log({
    tenantId: ctx.tenantId ?? null,
    actorId: userId,
    actorType: 'USER',
    action: AuditActions.AUTH_LOGIN_FAILED,
    resourceType: 'user_security',
    resourceId: userId,
    metadata: { reason: hold ? 'SIGNUP_HOLD' : 'ACCOUNT_SECURITY_LOCKED', source: lock.source, ...(ctx.method ? { method: ctx.method } : {}) },
    ipAddress: ctx.ipAddress ?? null,
    userAgent: ctx.userAgent ?? null,
  }).catch(() => {});
  // A sign-up hold asks for the e-mail verification the person can do on their own (02.6): the same answer an unverified account gets
  // where the tenant requires a verified address.
  if (hold) throw new AppError(UserSecurityMessages.EMAIL_VERIFICATION_REQUIRED, 403, ErrorCode.FORBIDDEN);
  throw new AppError(UserSecurityMessages.ACCOUNT_SECURITY_LOCKED, 403, ErrorCode.FORBIDDEN);
}

export type LockAccountInput = {
  /** When the lock stops holding by itself; omitted or null = until an unlock. Must be in the future. */
  until?: Date | null;
  /** Why (required): kept on the record and in the audit row, never shown to the person or mailed. */
  reason: string;
  /** The user who sets it; null for the firewall or another system actor. */
  actorId: string | null;
  /** Who decided: an administrator (default) or the firewall's responder. */
  source?: SecurityLockSource;
  /**
   * false: no "your account was locked" mail (default true). Only the sign-up hold (02.6) passes it: the new account was just sent its
   * verification mail, and a lock notice telling a person who signed up a minute ago to contact support would read as a broken product.
   */
  notify?: boolean;
};

function cleanReason(reason: unknown): string {
  const r = typeof reason === 'string' ? reason.trim() : '';
  if (!r) throw new AppError(UserSecurityMessages.SECURITY_LOCK_REASON_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);
  if (r.length > SECURITY_LOCK_REASON_MAX) throw new AppError(UserSecurityMessages.SECURITY_LOCK_REASON_TOO_LONG, 400, ErrorCode.VALIDATION_ERROR);
  return r;
}

/**
 * Sets the security lock and ends every live session of the account (all tenants, pending second-factor sign-ins included).
 *
 * Order: the lock is written first, so a sign-in racing this call either reads it at its gate or is caught by createSession's re-read
 * after it saved its row; then the sessions end; then the audit row (critical) and the critical mail. Locking an account that is
 * already locked replaces the lock (new reason and until) and ends the sessions again: the call is safe to repeat. When the sessions
 * cannot be ended the lock still holds for every new sign-in, the audit row says `sessionsEnded: false`, and the call fails (503, retryable) so
 * the caller retries.
 */
export async function lockAccount(userId: string, input: LockAccountInput): Promise<{ lock: SecurityLock; sessionsEnded: boolean }> {
  const reason = cleanReason(input.reason);
  const source = SecurityLockSourceEnum.parse(input.source ?? 'admin');
  const until = input.until ?? null;
  if (until && !(until instanceof Date && !Number.isNaN(until.getTime()) && until.getTime() > Date.now())) {
    throw new AppError(UserSecurityMessages.SECURITY_LOCK_UNTIL_INVALID, 400, ErrorCode.VALIDATION_ERROR);
  }
  const lockedAt = new Date();
  const patch: LockRow = {
    securityLockedAt: lockedAt,
    securityLockedUntil: until,
    securityLockReason: reason,
    securityLockedBy: input.actorId ?? null,
    securityLockSource: source,
  };

  const ds = await getDataSource();
  const repo = ds.getRepository(UserSecurityEntity);
  const existing = await repo.findOne({ where: { userId } });
  if (existing) {
    await repo.update({ userId }, patch as Parameters<typeof repo.update>[1]);
  } else {
    // An account that never signed in may have no record yet: the lock creates it.
    await repo.save(repo.create({ userId, otpMethods: [], otpBackupCodes: [], failedLoginAttempts: 0, ...patch } as Partial<UserSecurityEntity>));
  }
  await clearCache(userId);

  let sessionsEnded = true;
  try {
    // Dynamic: user_session requires user_security, so a static import here would be a cycle.
    const { default: UserSessionService } = await import('@kuraykaraaslan-labs/user_session/server/user_session.service');
    await UserSessionService.deleteAllSessions(userId);
  } catch (err) {
    sessionsEnded = false;
    Logger.error(`[user_security] security lock of ${userId}: the live sessions could not be ended: ${err instanceof Error ? err.message : String(err)}`);
  }

  const lock: SecurityLock = { lockedAt, until, reason, actorId: input.actorId ?? null, source };
  await AuditLogService.log({
    tenantId: null,
    actorId: input.actorId ?? null,
    actorType: input.actorId ? 'USER' : 'SYSTEM',
    action: AuditActions.AUTH_ACCOUNT_SECURITY_LOCKED,
    resourceType: 'user_security',
    resourceId: userId,
    metadata: { reason, source, until: until ? until.toISOString() : null, sessionsEnded, relocked: activeLockOf(existing as Partial<LockRow> | null) !== null },
  });
  if (input.notify !== false) void notifySecurityLock(userId, 'locked', until);

  if (!sessionsEnded) {
    throw new AppError(UserSecurityMessages.SECURITY_LOCK_SESSIONS_NOT_ENDED, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
  }
  return { lock, sessionsEnded };
}

/**
 * Lifts the security lock (the guessing lock is untouched: it has its own unlock, user.support.service `unlockAccount`). Every sign-in
 * method works again at once. Audited (high) even when nothing was locked, so a stray unlock is visible too; the person is mailed only
 * when a lock was lifted.
 */
export async function unlockAccount(userId: string, input: { actorId: string | null; reason?: string | null; source?: SecurityLockSource; notify?: boolean }): Promise<{ wasLocked: boolean }> {
  const source = SecurityLockSourceEnum.parse(input.source ?? 'admin');
  const reason = typeof input.reason === 'string' && input.reason.trim() ? input.reason.trim().slice(0, SECURITY_LOCK_REASON_MAX) : null;
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSecurityEntity);
  const existing = await repo.findOne({ where: { userId } });
  const before = activeLockOf(existing as Partial<LockRow> | null);
  if (existing && existing.securityLockedAt) {
    const cleared: LockRow = { securityLockedAt: null, securityLockedUntil: null, securityLockReason: null, securityLockedBy: null, securityLockSource: null };
    await repo.update({ userId }, cleared as Parameters<typeof repo.update>[1]);
    await clearCache(userId);
  }
  await AuditLogService.log({
    tenantId: null,
    actorId: input.actorId ?? null,
    actorType: input.actorId ? 'USER' : 'SYSTEM',
    action: AuditActions.AUTH_ACCOUNT_SECURITY_UNLOCKED,
    resourceType: 'user_security',
    resourceId: userId,
    metadata: {
      wasLocked: before !== null,
      source,
      ...(reason ? { reason } : {}),
      ...(before ? { lockedAt: before.lockedAt.toISOString(), lockSource: before.source, lockedBy: before.actorId } : {}),
    },
  });
  if (before && input.notify !== false) void notifySecurityLock(userId, 'unlocked', null);
  return { wasLocked: before !== null };
}

/**
 * The person is told, by the critical notice the guessing lock uses (user_security.login.service `notifyAccountLocked`): a lock an
 * account owner never hears of reads as a broken product, and a muted-email preference must not be why. Account-level, so under the
 * root tenant. The operator's reason is never in the mail. Never throws.
 */
async function notifySecurityLock(userId: string, what: 'locked' | 'unlocked', until: Date | null): Promise<void> {
  try {
    const { default: UserService } = await import('@kuraykaraaslan-labs/user/server/user.service');
    const user = await UserService.getById(userId).catch(() => null);
    const email = (user as { email?: string | null } | null)?.email;
    if (!email) return;
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    const notice = what === 'locked'
      ? {
        event: 'user_security.account_security_locked',
        title: 'Your account has been locked for your security',
        body: 'Your account was locked for security reasons and every active session was signed out. No sign-in method works until it is unlocked.',
        html: '<p>Your account was locked for security reasons and every active session was signed out. No sign-in method works until it is unlocked.</p>'
          + (until ? `<p>The lock ends by itself after <strong>${until.toISOString()}</strong>.</p>` : '<p>An administrator has to unlock it.</p>')
          + '<p>If you do not know why, please contact support.</p>',
      }
      : {
        event: 'user_security.account_security_unlocked',
        title: 'Your account has been unlocked',
        body: 'The security lock on your account was lifted. You can sign in again.',
        html: '<p>The security lock on your account was lifted. You can sign in again.</p>'
          + '<p>If you did not expect this, change your password after you sign in and review your active sessions.</p>',
      };
    await NotificationService.notifyCritical(
      ROOT_TENANT_ID,
      { userId, email },
      { event: notice.event, category: 'security', title: notice.title, body: notice.body, data: { html: notice.html } },
      { idempotencyKey: `${notice.event}:${userId}:${new Date().toISOString().slice(0, 16)}` },
    );
  } catch (err: unknown) {
    Logger.warn(`[user_security] security-lock mail failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
