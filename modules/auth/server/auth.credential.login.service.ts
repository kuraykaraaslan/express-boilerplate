import IpStrikeService from '@kuraykaraaslan-labs/limiter/server/limiter.ip-strikes';
import 'reflect-metadata';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import bcrypt from 'bcrypt';
import Logger from '@kuraykaraaslan-labs/logger';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { SafeUser, SafeUserSchema } from '@kuraykaraaslan-labs/user/server/user.types';
import AuthMessages from './auth.messages';
import AuthPolicyService from './auth.policy.service';
import CaptchaService from './auth.captcha.service';
import { signInLanePolicy } from '@kuraykaraaslan-labs/common/server/lane';
import type { Lane } from '@kuraykaraaslan-labs/common/server/lane.policy';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { recordLoginFailureMetric, emitAccountLockedEvent } from './auth.credential.helpers';
import { assertLocalCredentialsAllowed } from './auth.local-credentials';

/**
 * How many days before a password expires the user starts being warned.
 *
 * A hard `mustChangePassword` that arrives with no notice is a person locked
 * out of a form they were half way through, usually on the morning they had
 * something else to do. A week is enough to change it at a moment of their own
 * choosing; much longer and the warning is background noise by the time it
 * matters. Not a tenant setting: the number that would be worth configuring is
 * `maxAgeDays`, which already is one, and a second knob here would mostly be a
 * way to switch the warning off.
 */
export const PASSWORD_EXPIRY_WARNING_DAYS = 7;

/**
 * A bcrypt hash of a random string nobody knows, cost 10 like real hashes: an unknown address is compared against it so it
 * costs the same bcrypt time as a wrong password (no timing oracle for registered addresses).
 */
const DUMMY_PASSWORD_HASH = '$2b$10$ZMX39Gh8Lh9tHP4W8Rq2LeJCMpGbeKbJl2IO8WushWsXgyUJm9Daq';

export interface LoginResult {
  user: SafeUser;
  /** The password is already past `maxAgeDays` — they cannot go on without changing it. */
  mustChangePassword: boolean;
  /**
   * Days left before that becomes true, present only inside the warning window.
   * Absent means either "no expiry policy" or "not soon" — never "expired".
   */
  passwordExpiresInDays?: number;
}

export async function login({ email, password, captchaToken, tenantId, ipAddress, userAgent, lane }: {
  email: string;
  password: string;
  captchaToken?: string;
  tenantId?: string;
  ipAddress?: string;
  userAgent?: string;
  /** The request's lane (`laneOfRequest`); absent reads as the public lane. The CAPTCHA arms only where its sign-in lane's `captcha` column says so. */
  lane?: Lane;
}): Promise<LoginResult> {
  // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
  await assertLocalCredentialsAllowed();
  const accessPolicy = await AuthPolicyService.getAccessPolicy(tenantId);
  // Phase 55 00.8: the lane table's captcha column decides whether a challenge may be armed at all (38 L-4), read through
  // `signInLanePolicy` so a machine lane claimed by an unverified header is the strict public lane here (L-2), never an exemption.
  if (accessPolicy.captchaTriggerAttempts > 0
      && signInLanePolicy(lane).captcha
      && await CaptchaService.isRequired(email, accessPolicy.captchaTriggerAttempts)) {
    if (!captchaToken) throw new AppError(AuthMessages.CAPTCHA_REQUIRED, 400, ErrorCode.VALIDATION_ERROR);
    const ok = await CaptchaService.verify(captchaToken);
    if (!ok) throw new AppError(AuthMessages.CAPTCHA_INVALID, 400, ErrorCode.VALIDATION_ERROR);
  }

  const ds = await getDataSource();
  const user = await ds.getRepository(UserEntity).findOne({ where: { email: email.toLowerCase() } });
  if (!user) {
    await bcrypt.compare(password, DUMMY_PASSWORD_HASH).catch(() => false);
    AuditLogService.log({
      tenantId: tenantId ?? null, actorType: 'SYSTEM', action: AuditActions.AUTH_LOGIN_FAILED,
      metadata: { email: email.toLowerCase(), reason: 'USER_NOT_FOUND' }, ipAddress, userAgent,
    }).catch(() => {});
    recordLoginFailureMetric(tenantId, 'USER_NOT_FOUND');
    await CaptchaService.delayAfterFailure(Number(await CaptchaService.recordFailure(email).catch(() => 0)) || 0);
    await IpStrikeService.recordStrike(ipAddress, 'login_failed');
    throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401, ErrorCode.INVALID_CREDENTIALS);
  }


  if (await UserSecurityService.isLocked(user.userId)) {
    AuditLogService.log({
      tenantId: tenantId ?? null, actorId: user.userId, actorType: 'USER',
      action: AuditActions.AUTH_ACCOUNT_LOCKED, ipAddress, userAgent,
    }).catch(() => {});
    recordLoginFailureMetric(tenantId, 'ACCOUNT_LOCKED');
    throw new AppError(AuthMessages.ACCOUNT_LOCKED, 403, ErrorCode.FORBIDDEN);
  }

  const lockoutPolicy = await AuthPolicyService.getLockoutPolicy(tenantId);
  // A Fleet ID shadow user has no password (FID-07): it fails exactly like a wrong one, so the answer does not tell the two apart.
  const isPasswordValid = user.password ? await bcrypt.compare(password, user.password) : false;
  if (!isPasswordValid) {
    await UserSecurityService.recordLoginAttempt(user.userId, false, ipAddress, userAgent, {
      maxAttempts: lockoutPolicy.maxAttempts, lockDurationMinutes: lockoutPolicy.lockDurationMinutes,
    }).catch((err: unknown) => {
      Logger.warn(`AuthCredentialService.login: failed to record bad attempt: ${err instanceof Error ? err.message : String(err)}`);
    });
    AuditLogService.log({
      tenantId: tenantId ?? null, actorId: user.userId, actorType: 'USER',
      action: AuditActions.AUTH_LOGIN_FAILED, metadata: { reason: 'BAD_PASSWORD' }, ipAddress, userAgent,
    }).catch(() => {});
    recordLoginFailureMetric(tenantId, 'BAD_PASSWORD');
    await CaptchaService.delayAfterFailure(Number(await CaptchaService.recordFailure(email).catch(() => 0)) || 0);
    await IpStrikeService.recordStrike(ipAddress, 'login_failed');

    // GTH-18: when this bad attempt crossed the lockout threshold, notify the
    // tenant's security webhooks. Best-effort — never blocks the login path.
    if (await UserSecurityService.isLocked(user.userId).catch(() => false)) {
      emitAccountLockedEvent({
        tenantId, userId: user.userId, email: user.email,
        maxAttempts: lockoutPolicy.maxAttempts,
        lockDurationMinutes: lockoutPolicy.lockDurationMinutes,
        ipAddress, userAgent,
      });
    }
    throw new AppError(AuthMessages.INVALID_EMAIL_OR_PASSWORD, 401, ErrorCode.INVALID_CREDENTIALS);
  }

  // A disabled account is refused only once the password is right: a wrong one answers like any other bad login, so the
  // sign-in form does not tell a stranger that the address exists and is disabled.
  if (user.userStatus !== 'ACTIVE') {
    AuditLogService.log({
      tenantId: tenantId ?? null, actorId: user.userId, actorType: 'USER',
      action: AuditActions.AUTH_ACCOUNT_DISABLED, metadata: { reason: user.userStatus }, ipAddress, userAgent,
    }).catch(() => {});
    throw new AppError(AuthMessages.ACCOUNT_DISABLED, 403, ErrorCode.FORBIDDEN);
  }

  // GTH-1 / GTH-12: when the tenant requires a verified email, block login
  // until the user has confirmed their address.
  if (accessPolicy.emailVerificationRequired && !user.emailVerifiedAt) {
    AuditLogService.log({
      tenantId: tenantId ?? null, actorId: user.userId, actorType: 'USER',
      action: AuditActions.AUTH_LOGIN_FAILED, metadata: { reason: 'EMAIL_VERIFICATION_REQUIRED' }, ipAddress, userAgent,
    }).catch(() => {});
    recordLoginFailureMetric(tenantId, 'EMAIL_VERIFICATION_REQUIRED');
    throw new AppError(AuthMessages.EMAIL_VERIFICATION_REQUIRED, 403, ErrorCode.FORBIDDEN);
  }

  const passwordPolicy = await AuthPolicyService.getPasswordPolicy(tenantId);
  const changedAt = await UserSecurityService.getPasswordChangedAt(user.userId);
  let mustChangePassword = false;
  let passwordExpiresInDays: number | undefined;
  if (passwordPolicy.maxAgeDays > 0 && changedAt) {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const ageMs = Date.now() - changedAt.getTime();
    const remainingMs = passwordPolicy.maxAgeDays * DAY_MS - ageMs;
    if (remainingMs <= 0) mustChangePassword = true;
    else if (remainingMs <= PASSWORD_EXPIRY_WARNING_DAYS * DAY_MS) {
      // Rounded UP, so the last day reads "1 day left" rather than "0" — a
      // countdown that hits zero while the password still works is the kind of
      // detail that teaches people the warning is wrong.
      passwordExpiresInDays = Math.ceil(remainingMs / DAY_MS);
    }
  }

  if (accessPolicy.externalRequireMfa) {
    const sec = await UserSecurityService.getSafeByUserId(user.userId).catch(() => null);
    if (!sec || (sec.otpMethods?.length ?? 0) === 0) {
      AuditLogService.log({
        tenantId: tenantId ?? null, actorId: user.userId, actorType: 'USER',
        action: AuditActions.AUTH_LOGIN_FAILED, metadata: { reason: 'MFA_ENROLLMENT_REQUIRED' }, ipAddress, userAgent,
      }).catch(() => {});
      recordLoginFailureMetric(tenantId, 'MFA_ENROLLMENT_REQUIRED');
      throw new AppError(AuthMessages.MFA_ENROLLMENT_REQUIRED, 403, ErrorCode.FORBIDDEN);
    }
  }

  // The tenant scopes the lock / unlock audit rows. Phase 55 00.4: the login-anomaly check (and its one webhook) runs in createSession,
  // for every sign-in method; this call no longer judges the sign-in.
  await UserSecurityService.recordLoginAttempt(user.userId, true, ipAddress, userAgent, {
    maxAttempts: lockoutPolicy.maxAttempts, lockDurationMinutes: lockoutPolicy.lockDurationMinutes,
    ...(tenantId ? { tenantId } : {}),
  }).catch((err: unknown) => {
    Logger.warn(`AuthCredentialService.login: failed to record success: ${err instanceof Error ? err.message : String(err)}`);
  });
  await CaptchaService.clear(email).catch(() => {});

  AuditLogService.log({
    tenantId: tenantId ?? null, actorId: user.userId, actorType: 'USER',
    action: AuditActions.AUTH_LOGIN, metadata: { mustChangePassword, passwordExpiresInDays }, ipAddress, userAgent,
  }).catch(() => {});

  return { user: SafeUserSchema.parse(user), mustChangePassword, passwordExpiresInDays };
}
