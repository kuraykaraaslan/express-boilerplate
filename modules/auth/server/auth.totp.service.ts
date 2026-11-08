import { env } from '@kuraykaraaslan-labs/env';
import { authenticator } from 'otplib';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import redis from '@kuraykaraaslan-labs/redis';
import AuthMessages from './auth.messages';
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import { SafeUserSession } from '@kuraykaraaslan-labs/user_session/server/user_session.types';
import { OTPAction } from '@kuraykaraaslan-labs/user_security/server/user_security.enums';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import AuthPolicyService from './auth.policy.service';
import { assertLocalCredentialsAllowed } from './auth.local-credentials';
import {
  assertSecondFactorOpen,
  clearSecondFactorFailures,
  recordSecondFactorFailure,
  type SecondFactorAttempt,
} from './auth.second-factor-guard';

/** How `checkCode` treats the attempt beyond its own ledger and counter (phase 55 00.5). */
export interface CheckCodeOptions {
  /** What the caller knows of the request (address, lane, tenant, flow): the address is struck only on a human lane. */
  attempt?: SecondFactorAttempt;
  /**
   * Enrolment: the code is checked against a secret this very session was just given, so a wrong one is a typo, not a guess against
   * a factor that protects anything. It neither checks nor feeds the per-user second-factor block.
   */
  enrolment?: boolean;
  /** False when the caller records the failure itself (a code tried as TOTP and then as a recovery code counts once). */
  recordFailure?: boolean;
}

/** A recovery code is `dddd-dddd`; an authenticator code is digits only. Only used to name what a wrong code was meant to be. */
const RECOVERY_CODE_SHAPE = /^\d{4}-\d{4}$/;

export default class TOTPService {
  static TOTP_STEP_SECONDS = env.TOTP_STEP_SECONDS ?? 30;
  static TOTP_WINDOW = env.TOTP_WINDOW ?? 1;
  static TOTP_DIGITS = env.OTP_LENGTH ?? 6;
  static SETUP_EXPIRY_SECONDS = env.TOTP_SETUP_EXPIRY_SECONDS ?? 600;
  static DEFAULT_ISSUER = env.TOTP_ISSUER || 'App';
  /** Wrong codes (or replays) a user may send within `TOTP_LOCKOUT_SECONDS` before every code is refused until the window ends. */
  static TOTP_MAX_FAILURES = 5;
  static TOTP_LOCKOUT_SECONDS = 900;

  /**
   * How long a used code is remembered. otplib accepts a code while the current step is within `TOTP_WINDOW` steps of the code's
   * step, so one code verifies across (2 * window + 1) steps; one more step is the margin for a clock edge. Derived from the same
   * env values `setupOtpLib` hands otplib, so a wider window or a longer step never outlives its ledger entry.
   */
  static replaySeconds(): number {
    return TOTPService.TOTP_STEP_SECONDS * (2 * TOTPService.TOTP_WINDOW + 1) + TOTPService.TOTP_STEP_SECONDS;
  }

  static failKey(userId: string) {
    return `auth:totp:fail:${userId}`;
  }

  /** Hashed so a Redis dump does not list recently used codes next to their user. */
  static spentKey(userId: string, code: string) {
    return `auth:totp:spent:${crypto.createHash('sha256').update(`${userId}:${code}`).digest('hex')}`;
  }

  /**
   * The one place a code is checked against a user's TOTP secret (persisted or being enrolled). Every flow that takes a code
   * (login completion, step-up, impersonation step-up, legal hold, TOTP disable, enrolment) goes through it, so:
   *  - a code is single use across all of them (RFC 6238 §5.2): a code spent on one flow is refused on any other inside its
   *    validity, and a replay counts as a failure;
   *  - wrong codes are counted per user in Redis; at `TOTP_MAX_FAILURES` within `TOTP_LOCKOUT_SECONDS` every code is refused
   *    (429) until the window ends, so guessing does not scale with the number of IPs or challenges;
   *  - Redis that cannot answer refuses the code (503), never accepts it;
   *  - phase 55 00.5: outside enrolment, a blocked account is refused before anything (429 `SECOND_FACTOR_BLOCKED`), a wrong code or a
   *    replay also feeds the per-user second-factor counter, the address strike (human lanes) and the aggregated audit row
   *    (auth.second-factor-guard.ts), and a verified code clears that counter.
   */
  static async checkCode(userId: string, otpToken: string, secret: string, opts: CheckCodeOptions = {}): Promise<void> {
    const guarded = opts.enrolment !== true;
    if (guarded) await assertSecondFactorOpen(userId, opts.attempt);
    const store = async <T>(fn: () => Promise<T>): Promise<T> => {
      try {
        return await fn();
      } catch {
        throw new AppError(AuthMessages.TOTP_UNAVAILABLE, 503, ErrorCode.INTERNAL_ERROR, { retryable: true });
      }
    };
    const failKey = TOTPService.failKey(userId);
    // The attempt is counted before the code is looked at (INCR is atomic), and only a success clears it. A read-then-increment
    // would let a parallel burst of guesses all read a count under the limit and all be checked; here the sixth concurrent
    // request already sees six. SET NX EX first so the counter always carries the lockout TTL (INCR keeps it).
    const attempts = await store(async () => {
      await redis.set(failKey, '0', 'EX', TOTPService.TOTP_LOCKOUT_SECONDS, 'NX');
      const n = await redis.incr(failKey);
      if (n === 1) await redis.expire(failKey, TOTPService.TOTP_LOCKOUT_SECONDS);
      return n;
    });
    if (attempts > TOTPService.TOTP_MAX_FAILURES) throw new AppError(AuthMessages.TOTP_LOCKED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);

    const fail = async (): Promise<never> => {
      if (guarded && opts.recordFailure !== false) await recordSecondFactorFailure(userId, 'totp', opts.attempt);
      throw new AppError(AuthMessages.INVALID_OTP, 401, ErrorCode.INVALID_CREDENTIALS);
    };

    if (!TOTPService.verifyTokenWithSecret(otpToken, secret)) return fail();
    const fresh = await store(() => redis.set(TOTPService.spentKey(userId, otpToken), '1', 'EX', TOTPService.replaySeconds(), 'NX'));
    if (fresh !== 'OK') return fail();
    await store(() => redis.del(failKey));
    if (guarded) await clearSecondFactorFailures(userId, opts.attempt);
  }

  static async getIssuer(tenantId?: string): Promise<string> {
    if (!tenantId) return TOTPService.DEFAULT_ISSUER;
    const settings: Record<string, string> = await SettingService.getByKeys(tenantId, ['totpIssuer']).catch(() => ({}));
    return settings['totpIssuer']?.trim() || TOTPService.DEFAULT_ISSUER;
  }

  static setupOtpLib() {
    authenticator.options = {
      step: TOTPService.TOTP_STEP_SECONDS,
      window: TOTPService.TOTP_WINDOW,
      digits: TOTPService.TOTP_DIGITS,
    } as any;
  }

  static getRedisKey({ userSessionId, action }: { userSessionId: string; action: OTPAction | 'setup' }) {
    return `totp:${action}:${userSessionId}`;
  }

  static generateSecret() {
    TOTPService.setupOtpLib();
    return authenticator.generateSecret();
  }

  static async getOtpauthURL({ user, secret, tenantId }: { user: SafeUser; secret: string; tenantId?: string }) {
    TOTPService.setupOtpLib();
    const issuer = await TOTPService.getIssuer(tenantId);
    return authenticator.keyuri(user.email, issuer, secret);
  }

  // Start TOTP setup: generate temporary secret and return otpauth URL
  static async requestSetup({ user, userSession, tenantId }: { user: SafeUser; userSession: SafeUserSession; tenantId?: string }) {
    // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
    await assertLocalCredentialsAllowed();
    // GTH-13: a tenant can ban TOTP via its MFA method allow-list. Empty = all allowed.
    const accessPolicy = await AuthPolicyService.getAccessPolicy(tenantId);
    if (accessPolicy.mfaAllowedMethods.length > 0 && !accessPolicy.mfaAllowedMethods.includes('TOTP_APP')) {
      throw new AppError(AuthMessages.MFA_METHOD_NOT_ALLOWED, 403, ErrorCode.FORBIDDEN);
    }

    const tempSecret = TOTPService.generateSecret();
    const otpauthUrl = await TOTPService.getOtpauthURL({ user, secret: tempSecret, tenantId });

    const redisKey = TOTPService.getRedisKey({ userSessionId: userSession.userSessionId, action: 'setup' });
    await redis.set(redisKey, tempSecret, 'EX', TOTPService.SETUP_EXPIRY_SECONDS);

    return { secret: tempSecret, otpauthUrl };
  }

  static verifyTokenWithSecret(otpToken: string, secret: string): boolean {
    TOTPService.setupOtpLib();
    return authenticator.check(otpToken, secret);
  }

  // Verify the code against the temp secret and enable TOTP for the user
  static async verifyAndEnable({ user, userSession, otpToken }: { user: SafeUser; userSession: SafeUserSession; otpToken: string }) {
    // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
    await assertLocalCredentialsAllowed();
    const setupKey = TOTPService.getRedisKey({ userSessionId: userSession.userSessionId, action: 'setup' });
    const tempSecret = await redis.get(setupKey);

    if (!tempSecret) {
      throw new AppError(AuthMessages.INVALID_OTP, 400, ErrorCode.VALIDATION_ERROR);
    }

    await TOTPService.checkCode(user.userId, otpToken, tempSecret, { enrolment: true });

    const userSecurity = await UserSecurityService.getByUserId(user.userId);

    const newMethods = Array.from(new Set([...(userSecurity.otpMethods || []), 'TOTP_APP']));

    // Generate backup codes using crypto.randomInt for CSPRNG safety (KD-3).
    const codes: string[] = [];
    const makeCode = () => {
      const raw = Array.from({ length: 8 }, () => crypto.randomInt(0, 10).toString()).join('');
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    };

    for (let i = 0; i < 4; i++) codes.push(makeCode());
    const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

    // user_security seals the secret under the user's per-user data key (decision F27) before it reaches the database.
    await UserSecurityService.updateUserSecurity(user.userId, {
      otpSecret: tempSecret,
      otpMethods: newMethods as any,
      otpBackupCodes: hashed as any,
    });

    await redis.del(setupKey);

    return { enabled: true, backupCodes: codes };
  }

  // Verify a login/authenticate action using persisted secret. `attempt` (phase 55 00.5): what the caller knows of the request, for the
  // second-factor guard; `recordFailure: false` when the caller counts the failure itself.
  static async verifyAuthenticate({ user, otpToken, attempt, recordFailure }: {
    user: SafeUser;
    otpToken: string;
    attempt?: SecondFactorAttempt;
    recordFailure?: boolean;
  }) {
    const userSecurity = await UserSecurityService.getByUserId(user.userId);

    if (!userSecurity) {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    if (!userSecurity.otpMethods.includes('TOTP_APP' as any) || !userSecurity.otpSecret) {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    const secret = decryptFieldOpt(userSecurity.otpSecret) ?? userSecurity.otpSecret;
    await TOTPService.checkCode(user.userId, otpToken, secret as string, { attempt, recordFailure });

    return { verified: true };
  }

  // Try TOTP first; if it fails, fallback to backup codes. Phase 55 00.5: one typed value is one attempt, so a value that is neither
  // a valid TOTP code nor a recovery code counts once (as what its shape says it was meant to be), not twice.
  static async verifyAuthenticateOrBackup({ user, otpToken, attempt }: { user: SafeUser; otpToken: string; attempt?: SecondFactorAttempt }) {
    try {
      await TOTPService.verifyAuthenticate({ user, otpToken, attempt, recordFailure: false });
      return { verified: true, method: 'TOTP' };
    } catch (e) {
      // A locked factor or an unanswered Redis is not a wrong code: the backup codes are not a way around either.
      if (e instanceof AppError && (e.statusCode === 429 || e.statusCode >= 500)) throw e;
      const consumed = await TOTPService.consumeBackupCode({ user, code: otpToken, attempt, recordFailure: false });
      if (!consumed.consumed) {
        await recordSecondFactorFailure(user.userId, RECOVERY_CODE_SHAPE.test(otpToken.trim()) ? 'recovery_code' : 'totp', attempt);
        throw new AppError(AuthMessages.INVALID_OTP, 401, ErrorCode.INVALID_CREDENTIALS);
      }
      return { verified: true, method: 'BACKUP_CODE' };
    }
  }

  static async disable({ user, otpToken, attempt }: { user: SafeUser; otpToken: string; attempt?: SecondFactorAttempt }) {
    const userSecurity = await UserSecurityService.getByUserId(user.userId);

    if (!userSecurity) {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    if (!userSecurity.otpMethods.includes('TOTP_APP' as any) || !userSecurity.otpSecret) {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    const secretForDisable = decryptFieldOpt(userSecurity.otpSecret) ?? userSecurity.otpSecret;
    await TOTPService.checkCode(user.userId, otpToken, secretForDisable as string, { attempt: { flow: 'totp_disable', ...attempt } });

    const newMethods = (userSecurity.otpMethods || []).filter(m => m !== 'TOTP_APP');
    await UserSecurityService.updateUserSecurity(user.userId, {
      otpSecret: undefined,
      otpMethods: newMethods as any,
      otpBackupCodes: [],
    });
    return { disabled: true };
  }

  // Generate backup codes, store hashed; return plaintext codes to the user
  static async generateBackupCodes({ user, count = 4 }: { user: SafeUser; count?: number }) {
    const userSecurity = await UserSecurityService.getByUserId(user.userId);

    if (!userSecurity) {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    if (!userSecurity.otpMethods.includes('TOTP_APP' as any) || !userSecurity.otpSecret) {
      throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    const codes: string[] = [];
    // Use crypto.randomInt for CSPRNG safety (KD-3).
    const makeCode = () => {
      const raw = Array.from({ length: 8 }, () => crypto.randomInt(0, 10).toString()).join('');
      return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    };

    for (let i = 0; i < count; i++) codes.push(makeCode());
    const hashed = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));

    await UserSecurityService.updateUserSecurity(user.userId, {
      otpBackupCodes: hashed as any,
    });

    return { codes };
  }

  // Consume a backup code: verify and remove it from stored list. Phase 55 00.5: a blocked account is refused first (429), a code that
  // matches none counts as a wrong recovery code (unless the caller counts it, `recordFailure: false`), a consumed one clears the count.
  static async consumeBackupCode({ user, code, attempt, recordFailure }: {
    user: SafeUser;
    code: string;
    attempt?: SecondFactorAttempt;
    recordFailure?: boolean;
  }) {
    await assertSecondFactorOpen(user.userId, attempt);

    const userSecurity = await UserSecurityService.getByUserId(user.userId);
    
    const list = userSecurity.otpBackupCodes || [];
    if (!list.length) {
      return { consumed: false };
    }

    let matchIndex = -1;
    for (let i = 0; i < list.length; i++) {
      const ok = await bcrypt.compare(code, list[i]);
      if (ok) { matchIndex = i; break; }
    }

    if (matchIndex === -1) {
      if (recordFailure !== false) await recordSecondFactorFailure(user.userId, 'recovery_code', attempt);
      return { consumed: false };
    }

    // auth.12: claim the matched code atomically before removing it (the list update is a read-modify-write): of two
    // concurrent submissions of one code only the one whose SET NX lands counts; the other is a used code.
    const claimKey = `totp:backup-spent:${user.userId}:${crypto.createHash('sha256').update(list[matchIndex]!).digest('hex')}`;
    const claimed = await redis.set(claimKey, '1', 'EX', 7 * 24 * 3600, 'NX').catch(() => null);
    if (claimed !== 'OK') {
      return { consumed: false };
    }

    const newList = list.filter((_, idx) => idx !== matchIndex);
    await UserSecurityService.updateUserSecurity(user.userId, {
      otpBackupCodes: newList as any,
    });
    await clearSecondFactorFailures(user.userId, attempt);
    // Phase 55 00.4: a recovery code standing in for the authenticator is a signal of its own (a lost phone, or stolen codes): one
    // `auth.recovery_code_used` row (high) with the codes left. Best-effort: it never undoes the step it audits.
    void import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
      .then(({ default: AuditLogService }) => AuditLogService.log({
        tenantId: attempt?.tenantId ?? null, actorId: user.userId, actorType: 'USER', action: AuditActions.AUTH_RECOVERY_CODE_USED,
        resourceType: 'user_security', resourceId: user.userId,
        metadata: { codesLeft: newList.length, flow: attempt?.flow ?? 'other' },
      }))
      .catch(() => {});

    return { consumed: true };
  }
}
