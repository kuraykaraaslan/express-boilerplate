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

/**
 * The password sign-in's bookkeeping: the guessing lock (failed passwords) and, on success, the last sign-in's time. Phase 55 00.4
 * (P-4): it no longer judges the sign-in, and the last sign-in's address and device are written by `recordSignInPlace`, which
 * createSession calls for EVERY sign-in method after the login-anomaly assessment has read the previous place (written here, before
 * createSession, the password sign-in compared its own address with itself). The new-address / new-device check that ran here, and webhooked
 * `security.login_anomaly` a second time for every risky password login, is part of the one detector in user_session
 * (`user_session.login-risk.service.ts`, reasons `new_ip` / `new_device`), which every sign-in method goes through. Its new-device
 * mail went with it: it was only sent without `notify: false`, which its one caller always passed (the login routes send the
 * located alert, 38-security 3.6).
 */
export async function recordLoginAttempt(
  userId: string,
  success: boolean,
  ip?: string,
  device?: string,
  options?: { maxAttempts?: number; lockDurationMinutes?: number; tenantId?: string },
): Promise<void> {
  const ds = await getDataSource();
  const repo = ds.getRepository(UserSecurityEntity);
  const security = await repo.findOne({ where: { userId } });
  if (!security) throw new AppError(UserSecurityMessages.SECURITY_RECORD_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

  const maxAttempts = options?.maxAttempts ?? 5;
  const lockDurationMinutes = options?.lockDurationMinutes ?? 15;

  if (success) {
    const wasLocked = Boolean(security.lockedUntil);
    await repo.update({ userId }, {
      lastLoginAt: new Date(),
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    });
    // A successful login clears any prior lock — record the recovery.
    if (wasLocked) {
      auditSecurityEvent(options?.tenantId, userId, 'auth.account_unlocked', { via: 'successful_login' });
    }
  } else {
    // Adaptive lockout: exponential backoff once the threshold is crossed.
    // auth.02: the counter is advanced with a compare-and-set on the value it was read at, so concurrent wrong passwords
    // each count (a plain read-modify-write let a burst of parallel guesses land as ONE failure). A lost race re-reads and
    // tries again; after a few losses the last read wins rather than dropping the failure.
    let previous = security.failedLoginAttempts ?? 0;
    let attempts = previous + 1;
    let lockedUntil: Date | undefined;
    const lockFor = (n: number): Date | undefined => {
      if (n < maxAttempts) return undefined;
      const minutes = Math.min(lockDurationMinutes * 2 ** (n - maxAttempts), 24 * 60); // cap at 24h
      return new Date(Date.now() + minutes * 60 * 1000);
    };
    for (let round = 0; ; round += 1) {
      attempts = previous + 1;
      lockedUntil = lockFor(attempts);
      const last = round >= 4;
      const res = await repo.update(
        last ? { userId } : { userId, failedLoginAttempts: previous },
        { failedLoginAttempts: attempts, lockedUntil },
      ) as { affected?: number } | undefined;
      if (last || res?.affected !== 0) break;
      const fresh = await repo.findOne({ where: { userId } });
      previous = fresh?.failedLoginAttempts ?? previous;
    }
    // Audit + notify only on the unlocked→locked transition, not on later
    // post-threshold failures that merely extend an existing lock.
    const justLocked = Boolean(lockedUntil) && previous < maxAttempts;
    if (justLocked) {
      auditSecurityEvent(options?.tenantId, userId, AuditActions.AUTH_ACCOUNT_LOCKED, {
        failedAttempts: attempts,
        lockedUntil: lockedUntil!.toISOString(),
        ip: ip ?? null,
      });
      notifyAccountLocked(options?.tenantId, userId, lockedUntil!).catch(() => {});
    }
  }
  await clearCache(userId);
}

/**
 * The last sign-in's address and User-Agent (`lastLoginIp`, `lastLoginDevice`), which the next sign-in's `new_ip` / `new_device` are
 * measured against (user_session.login-risk.service). Called by createSession for every sign-in method, after the assessment, so the
 * record survives a sign-out, an expiry prune or a session wipe. A user without a security row is a no-op. Throws on a store failure;
 * the caller treats it as best-effort.
 */
export async function recordSignInPlace(userId: string, ip: string | null | undefined, device: string | null | undefined): Promise<void> {
  const repo = (await getDataSource()).getRepository(UserSecurityEntity);
  await repo.update({ userId }, { lastLoginIp: ip ?? null, lastLoginDevice: device ?? null } as never);
  await clearCache(userId);
}

/** Best-effort security audit entry (mirrors auth's account-lock audit); never throws into the caller. */
function auditSecurityEvent(
  tenantId: string | undefined,
  userId: string,
  action: string,
  metadata: Record<string, unknown>,
): void {
  AuditLogService.log({
    tenantId: tenantId ?? null,
    actorId: userId,
    actorType: 'USER',
    action,
    resourceType: 'user_security',
    resourceId: userId,
    metadata,
  }).catch(() => {});
}

/**
 * Best-effort "account locked" email. Resolves the address via the user module
 * and sends through the notification dispatcher; both are dynamic-imported so
 * the notification stack only loads when a lock actually fires. Never throws
 * into the login path.
 */
async function notifyAccountLocked(tenantId: string | undefined, userId: string, lockedUntil: Date): Promise<void> {
  try {
    const { default: UserService } = await import('@kuraykaraaslan-labs/user/server/user.service');
    const user = await UserService.getById(userId).catch(() => null);
    const email = (user as { email?: string | null } | null)?.email;
    if (!email) return;
    // Through the dispatcher (PLAT-01), and CRITICAL: this is the textbook
    // account-control notice. Someone locked out of their own account must hear
    // why, and a muted-email preference cannot be allowed to be the reason they
    // do not — that is exactly the lockout `notifyCritical` refuses to create.
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    await NotificationService.notifyCritical(
      tenantId ?? ROOT_TENANT_ID,
      { userId, email },
      {
        event: 'user_security.account_locked',
        category: 'security',
        title: 'Your account has been temporarily locked',
        body: 'Your account was locked after too many failed sign-in attempts.',
        data: {
          html: `<p>Your account was locked after too many failed sign-in attempts. Access is automatically restored after <strong>${lockedUntil.toISOString()}</strong>.</p>`
            + '<p>If this was not you, please reset your password once you can sign in again.</p>',
        },
      },
    );
  } catch (err: unknown) {
    Logger.warn(`[user_security] account-locked mail failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function isLocked(userId: string): Promise<boolean> {
  const ds = await getDataSource();
  const security = await ds.getRepository(UserSecurityEntity).findOne({ where: { userId } });
  if (!security || !security.lockedUntil) return false;
  return new Date() < security.lockedUntil;
}

/**
 * KD-7: Append a new password hash to the rotation history and trim to
 * the most-recent `historyCount` entries. Also stamps `passwordChangedAt`
 * and clears `mustChangePassword`. Callers must pass an already-hashed
 * value (bcrypt) — never plaintext.
 */
export async function pushPasswordHistory(userId: string, passwordHash: string, historyCount: number): Promise<void> {
  const ds = await getDataSource();
  await ds.transaction(async (manager) => {
    const repo = manager.getRepository(UserSecurityEntity);
    const security = await repo.findOne({ where: { userId } });
    if (!security) throw new AppError(UserSecurityMessages.SECURITY_RECORD_NOT_FOUND, 404, ErrorCode.NOT_FOUND);

    const existing = Array.isArray(security.passwordHistory) ? (security.passwordHistory as string[]) : [];
    const next = [passwordHash, ...existing].slice(0, Math.max(0, historyCount));

    await repo.update({ userId }, {
      passwordHistory: next as any,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
    });
  });
  await clearCache(userId);
  // The other alert nothing was sending: `password_changed` had a template and
  // no caller. A password change the owner did not make is the single most
  // useful thing to tell them about, and the audit trail alone tells nobody.
  void notifyPasswordChanged(userId);
}

/**
 * Resolve a user's address once, for the security notices below. Returns null
 * for a user that vanished — a missing address is a skipped mail, never a
 * thrown error inside a login or a password change.
 */
async function resolveUser(userId: string): Promise<{ email: string; name?: string } | null> {
  try {
    const { default: UserService } = await import('@kuraykaraaslan-labs/user/server/user.service');
    const user = await UserService.getById(userId).catch(() => null);
    const email = (user as { email?: string | null } | null)?.email;
    if (!email) return null;
    return { email, name: (user as { name?: string } | null)?.name };
  } catch {
    return null;
  }
}

/**
 * The notice is CRITICAL. A password changing on your account is exactly the
 * message a preference toggle must never be able to silence — and
 * `notifyCritical` is the one path that guarantees it. (The new-device notice
 * that also came through here is sent by the login routes since 38-security
 * 3.6; its copy in this file was removed with the second anomaly detector,
 * phase 55 00.4.)
 */
async function sendSecurityNotice(
  tenantId: string,
  userId: string,
  event: string,
  rendered: { subject: string; html: string } | null,
  email: string,
  idempotencyKey?: string,
): Promise<void> {
  if (!rendered) return;
  const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
  await NotificationService.notifyCritical(
    tenantId,
    { userId, email },
    { event, category: 'security', title: rendered.subject, body: rendered.subject, data: { html: rendered.html } },
    idempotencyKey ? { idempotencyKey } : {},
  );
}

async function notifyPasswordChanged(userId: string): Promise<void> {
  try {
    const user = await resolveUser(userId);
    if (!user) return;
    const { default: MailAccountTemplatesService } = await import('@kuraykaraaslan-labs/notification_mail/server/notification_mail.account-templates.service');
    const rendered = await MailAccountTemplatesService.renderPasswordChanged({ email: user.email, name: user.name });
    // A password change is an ACCOUNT-level fact, not a workspace one: it is
    // sent under the root tenant so a user who belongs to several workspaces
    // is told once, by the platform, rather than once per membership.
    await sendSecurityNotice(ROOT_TENANT_ID, userId, 'user_security.password_changed', rendered, user.email);
  } catch (err) {
    Logger.warn(`[user_security] password-changed alert failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function getPasswordHistory(userId: string): Promise<string[]> {
  const ds = await getDataSource();
  const security = await ds.getRepository(UserSecurityEntity).findOne({ where: { userId } });
  if (!security) return [];
  return Array.isArray(security.passwordHistory) ? (security.passwordHistory as string[]) : [];
}

export async function getPasswordChangedAt(userId: string): Promise<Date | null> {
  const ds = await getDataSource();
  const security = await ds.getRepository(UserSecurityEntity).findOne({ where: { userId } });
  return security?.passwordChangedAt ?? null;
}

export async function setMustChangePassword(userId: string, value: boolean): Promise<void> {
  const ds = await getDataSource();
  await ds.getRepository(UserSecurityEntity).update({ userId }, { mustChangePassword: value });
  await clearCache(userId);
}
