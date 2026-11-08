import { env } from '@kuraykaraaslan-labs/env';
import crypto from "crypto";
import redis from "@kuraykaraaslan-labs/redis";
import { SafeUser } from "@kuraykaraaslan-labs/user/server/user.types";
import { SafeUserSession } from "@kuraykaraaslan-labs/user_session/server/user_session.types";
import { OTPMethod, OTPAction } from "@kuraykaraaslan-labs/user_security/server/user_security.enums";
import UserSessionService from "@kuraykaraaslan-labs/user_session/server/user_session.service";
import MailTemplatesService from "@kuraykaraaslan-labs/notification_mail/server/notification_mail.templates.service";
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import SMSService from "@kuraykaraaslan-labs/notification_sms/server/notification_sms.service";
import AuthMessages from "./auth.messages";
import AuthPolicyService from "./auth.policy.service";
import { authEmailSubject } from "./auth.i18n";
import type { AuthLocale } from "./dictionaries";
import Logger from "@kuraykaraaslan-labs/logger";
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import {
  assertSecondFactorOpen,
  clearSecondFactorFailures,
  recordSecondFactorFailure,
  type SecondFactorAttempt,
  type SecondFactorFlow,
} from './auth.second-factor-guard';

/** The flow a code of this action completes (audit metadata of the second-factor guard). */
const FLOW_OF_ACTION: Record<OTPAction, SecondFactorFlow> = { authenticate: 'sign_in', enable: 'otp_enable', disable: 'otp_disable' };

/**
 * Phase 55 00.4: a proven code is audited as `auth.otp_verified` (low), the action that was defined and never written; with the
 * failures the second-factor guard already writes, the firewall sees both sides. Best-effort: the row never delays or fails the step.
 */
function auditOtpVerified(user: SafeUser, tenantId: string | null, method: OTPMethod, action: OTPAction, flow: string): void {
  void import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    .then(({ default: AuditLogService }) => AuditLogService.log({
      tenantId, actorId: user.userId, actorType: 'USER', action: AuditActions.AUTH_OTP_VERIFIED,
      resourceType: 'user_security', resourceId: user.userId, metadata: { method, action, flow },
    }))
    .catch(() => {});
}

export default class OTPService {
  // GTH-3: env values are the fallback default only; per-tenant OTP knobs are
  // resolved at runtime via AuthPolicyService.getOtpPolicy(tenantId).
  private static readonly OTP_LENGTH = env.OTP_LENGTH ?? 6;

  /**
   * Generate a numeric OTP token
   */
  static generateToken(length = OTPService.OTP_LENGTH): string {
    const min = Math.pow(10, length - 1);
    const max = Math.pow(10, length) - 1;
    return Math.floor(min + crypto.randomInt(max - min + 1))
      .toString()
      .padStart(length, "0");
  }

  /**
   * Hash OTP token
   */
  private static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Get Redis key for OTP
   */
  private static getOTPKey(userSessionId: string, method: OTPMethod, action: OTPAction): string {
    return `otp:${action}:${userSessionId}:${method}`;
  }

  /**
   * Get Redis key for rate limiting
   */
  private static getRateKey(userSessionId: string, method: OTPMethod): string {
    return `otp:rate:${userSessionId}:${method}`;
  }

  /**
   * Get Redis key for attempt tracking
   */
  private static getAttemptKey(userSessionId: string, method: OTPMethod, action: OTPAction): string {
    return `otp:attempts:${userSessionId}:${method}:${action}`;
  }

  /**
   * Request OTP - generates and sends OTP via specified method
   */
  static async requestOTP({
    user,
    userSession,
    method,
    action,
    tenantId,
    locale,
  }: {
    user: SafeUser;
    userSession: SafeUserSession;
    method: OTPMethod;
    action: OTPAction;
    /** GTH-3/5/13: per-tenant TTLs, mail routing, and MFA method allow-list. */
    tenantId?: string;
    /** GTH-10: recipient locale for the transactional email subject. */
    locale?: AuthLocale;
  }): Promise<{ otpToken: string }> {
    if (method === "TOTP_APP") {
      throw new AppError(AuthMessages.USE_AUTHENTICATOR_APP, 400, ErrorCode.VALIDATION_ERROR);
    }

    // GTH-13: enforce the tenant's MFA method allow-list. Empty = all allowed.
    const accessPolicy = await AuthPolicyService.getAccessPolicy(tenantId);
    if (accessPolicy.mfaAllowedMethods.length > 0 && !accessPolicy.mfaAllowedMethods.includes(method as any)) {
      throw new AppError(AuthMessages.MFA_METHOD_NOT_ALLOWED, 403, ErrorCode.FORBIDDEN);
    }

    // GTH-3: per-tenant OTP knobs (length/expiry/rate-limit/attempts).
    const otpPolicy = await AuthPolicyService.getOtpPolicy(tenantId);

    const rateKey = this.getRateKey(userSession.userSessionId, method);

    // Check rate limit
    const rateCount = await redis.get(rateKey);
    if (rateCount && parseInt(rateCount) >= otpPolicy.maxAttempts) {
      throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }

    // Increment rate limit
    if (rateCount) {
      await redis.incr(rateKey);
    } else {
      await redis.setex(rateKey, otpPolicy.rateLimitSeconds, "1");
    }

    // Validate delivery prerequisites before generating the OTP
    if (method === "SMS" && !user.phone) {
      throw new AppError(AuthMessages.USER_HAS_NO_PHONE_NUMBER, 422, ErrorCode.VALIDATION_ERROR);
    }

    // Generate OTP
    const otpToken = this.generateToken(otpPolicy.length);
    const hashedToken = this.hashToken(otpToken);

    // Store OTP
    const otpKey = this.getOTPKey(userSession.userSessionId, method, action);
    await redis.setex(otpKey, otpPolicy.expirySeconds, hashedToken);

    // GTH-5: route auth mail/SMS through the request tenant's own provider +
    // branding; fall back to the root tenant when no tenant context is present.
    const deliveryTenantId = tenantId ?? ROOT_TENANT_ID;

    // Send OTP — delivery failures are logged but must NOT propagate to the frontend
    switch (method) {
      case "EMAIL":
        void OTPService.mailOtp(deliveryTenantId, { userId: user.userId, email: user.email }, otpToken, authEmailSubject('otp', locale));
        break;

      case "SMS":
        SMSService.sendShortMessage(deliveryTenantId, {
          to: user.phone!,
          body: `Your verification code is ${otpToken}. Valid for ${Math.round(otpPolicy.expirySeconds / 60)} minutes.`,
        }).catch((err: unknown) => {
          Logger.error(`OTPService: sendShortMessage failed for user ${user.userId}: ${err instanceof Error ? err.message : err}`);
        });
        break;

      default:
        throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400, ErrorCode.VALIDATION_ERROR);
    }

    Logger.info(`OTP sent via ${method} to user ${user.userId}`);

    return { otpToken };
  }

  /**
   * Verify OTP
   */
  static async verifyOTP({
    user,
    userSession,
    method,
    action,
    otpToken,
    tenantId,
    attempt,
  }: {
    user: SafeUser;
    userSession: SafeUserSession;
    method: OTPMethod;
    action: OTPAction;
    otpToken: string;
    tenantId?: string;
    /**
     * Phase 55 00.5: what the route knows of the request (`secondFactorAttemptOf`): the address, whether its lane is a human one,
     * the flow. Without it a wrong code still counts per user and is audited; only the address strike needs it.
     */
    attempt?: SecondFactorAttempt;
  }): Promise<{ verified: boolean }> {
    // The session the code is typed in: an in-session flow counts on it, never on the account (auth.second-factor-guard.ts).
    const guardAttempt: SecondFactorAttempt = {
      tenantId: tenantId ?? null,
      flow: FLOW_OF_ACTION[action] ?? 'other',
      ...attempt,
      userSessionId: attempt?.userSessionId ?? userSession.userSessionId,
    };
    if (method === "TOTP_APP") {
      // auth.19: an authenticator-app code completes the sign-in step like an e-mail or SMS code. Only `authenticate`: enabling or
      // disabling TOTP has its own routes (totp/enable, totp/disable). The code is checked by TOTPService (replay and lockout included).
      if (action !== "authenticate") {
        throw new AppError(AuthMessages.USE_AUTHENTICATOR_APP, 400, ErrorCode.VALIDATION_ERROR);
      }
      const { default: TOTPService } = await import("./auth.totp.service");
      await TOTPService.verifyAuthenticate({ user, otpToken, attempt: guardAttempt });
      if (userSession.otpVerifyNeeded) {
        await UserSessionService.updateSession(userSession.userSessionId, { otpVerifyNeeded: false, amrAdd: ['otp', 'mfa'] });
      }
      Logger.info(`OTP verified via TOTP_APP for user ${user.userId}`);
      auditOtpVerified(user, tenantId ?? null, method, action, guardAttempt.flow ?? 'other');
      return { verified: true };
    }

    // Phase 55 00.5: the per-user second-factor block of a sign-in holds across sessions (the attempt budget below is per session, and a
    // new sign-in mints a new session), so it is checked before the budget is spent; an in-session code checks its session's block.
    await assertSecondFactorOpen(user.userId, guardAttempt);

    const otpPolicy = await AuthPolicyService.getOtpPolicy(tenantId);
    const otpKey = this.getOTPKey(userSession.userSessionId, method, action);
    const attemptKey = this.getAttemptKey(userSession.userSessionId, method, action);

    // A budget already spent is refused first (the code may already be destroyed, the answer stays 429).
    const spent = Number(await redis.get(attemptKey)) || 0;
    if (spent >= otpPolicy.maxAttempts) {
      await redis.del(otpKey);
      throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }

    // Get stored OTP
    const storedHash = await redis.get(otpKey);
    if (!storedHash) {
      throw new AppError(AuthMessages.OTP_EXPIRED, 400, ErrorCode.VALIDATION_ERROR);
    }

    // auth.03 / auth.23: the attempt is counted BEFORE the comparison, with one atomic INCR (the first one arms the window).
    // A GET-compare-INCR let any number of parallel guesses pass the cap, and two parallel wrong guesses spent one attempt.
    const attempts = Number(await redis.incr(attemptKey)) || 0;
    if (attempts === 1) await redis.expire(attemptKey, otpPolicy.expirySeconds).catch(() => {});
    if (attempts > otpPolicy.maxAttempts) {
      // Clear the OTP on too many attempts
      await redis.del(otpKey);
      throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }

    // Verify OTP
    const inputHash = this.hashToken(otpToken);
    if (inputHash !== storedHash) {
      await recordSecondFactorFailure(user.userId, method === 'SMS' ? 'sms_otp' : 'email_otp', guardAttempt);
      throw new AppError(AuthMessages.INVALID_OTP, 401, ErrorCode.INVALID_CREDENTIALS);
    }

    // auth.22: consume the code atomically. Of two submissions that both read the hash before either deleted it, only the one
    // whose DEL removed the key wins; the other is answered like a code that is gone.
    const consumed = Number(await redis.del(otpKey)) || 0;
    if (consumed < 1) {
      throw new AppError(AuthMessages.OTP_EXPIRED, 400, ErrorCode.VALIDATION_ERROR);
    }
    await redis.del(attemptKey);
    await redis.del(this.getRateKey(userSession.userSessionId, method));
    await clearSecondFactorFailures(user.userId, guardAttempt);

    // If this was for authentication, mark session as verified
    if (action === "authenticate" && userSession.otpVerifyNeeded) {
      // The second factor is proven now: the session's `amr` gains `otp` and `mfa` (RFC 8176), which Fleet ID passes on to the nodes.
      await UserSessionService.updateSession(userSession.userSessionId, {
        otpVerifyNeeded: false,
        amrAdd: ['otp', 'mfa'],
      });
    }

    Logger.info(`OTP verified via ${method} for user ${user.userId}`);
    auditOtpVerified(user, tenantId ?? null, method, action, guardAttempt.flow ?? 'other');

    return { verified: true };
  }

  /**
   * Invalidate all OTPs for a session
   */
  static async invalidateSessionOTPs(userSessionId: string): Promise<void> {
    const methods: OTPMethod[] = ["EMAIL", "SMS"];
    const actions: OTPAction[] = ["enable", "disable", "authenticate"];

    for (const method of methods) {
      for (const action of actions) {
        await redis.del(this.getOTPKey(userSessionId, method, action));
        await redis.del(this.getAttemptKey(userSessionId, method, action));
      }
      await redis.del(this.getRateKey(userSessionId, method));
    }
  }

  /**
   * Two-factor was turned ON or OFF for this account — CRITICAL, every channel.
   *
   * The `otp_enabled.ejs` / `otp_disabled.ejs` templates have existed all along
   * with NO caller, so the product has been promising an alert it never sent.
   * This is the trigger they were written for, and it is the strongest kind of
   * security notice there is: somebody disabling your second factor is the first
   * move in taking the account, and the owner has to hear about it even if they
   * muted everything else.
   *
   * Best-effort — the setting has already been written when this runs, and the
   * route must not 500 because a notice did not go out.
   */
  static async notifyOtpMethodChanged(
    tenantId: string,
    to: { userId: string; email: string },
    enabled: boolean,
  ): Promise<void> {
    try {
      const rendered = enabled
        ? await MailTemplatesService.renderOtpEnabled({ tenantId, email: to.email })
        : await MailTemplatesService.renderOtpDisabled({ tenantId, email: to.email });
      if (!rendered) return;
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
      await NotificationService.notifyCritical(
        tenantId,
        to,
        {
          event: enabled ? 'auth.otp_enabled' : 'auth.otp_disabled',
          category: 'security',
          title: rendered.subject,
          body: rendered.subject,
          data: { html: rendered.html },
        },
      );
    } catch (err: unknown) {
      Logger.error(`OTPService: OTP ${enabled ? 'enabled' : 'disabled'} notice failed for user ${to.userId}: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * The OTP itself, through the dispatcher (PLAT-01).
   *
   * CRITICAL and **mail only**. Critical because a one-time code is the thing
   * standing between the user and their own account; a preference that silenced
   * it would lock them out of the login they are in the middle of. Mail only
   * because the CALLER already asked for a channel — the user picked EMAIL, and
   * the dispatcher's default fan-out would deliver the same live code by SMS,
   * push and in-app as well, which is both wrong and a wider blast radius for a
   * credential.
   *
   * Fire-and-forget, like the send it replaces: a delivery failure is logged and
   * must never propagate to the frontend (it would tell an attacker which
   * addresses exist).
   */
  private static async mailOtp(
    tenantId: string,
    to: { userId: string; email: string },
    otpToken: string,
    subject?: string,
  ): Promise<void> {
    try {
      const rendered = await MailTemplatesService.renderOtp({ tenantId, email: to.email, otpToken, subject });
      if (!rendered) return;
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
      await NotificationService.notifyCritical(
        tenantId,
        to,
        { event: 'auth.otp', category: 'security', title: rendered.subject, body: rendered.subject, data: { html: rendered.html } },
        { channels: ['mail'] },
      );
    } catch (err: unknown) {
      Logger.error(`OTPService: OTP mail failed for user ${to.userId}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
