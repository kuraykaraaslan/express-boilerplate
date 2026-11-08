import 'reflect-metadata';
import { env } from '@kuraykaraaslan-labs/env';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import redis from '@kuraykaraaslan-labs/redis';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import UserService from '@kuraykaraaslan-labs/user/server/user.service';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import MailTemplatesService from '@kuraykaraaslan-labs/notification_mail/server/notification_mail.templates.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AuthMessages from './auth.messages';
import { checkPasswordBreach } from './auth.breach-check';
import AuthPolicyService from './auth.policy.service';
import { authEmailSubject } from './auth.i18n';
import type { AuthLocale } from './dictionaries';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import { assertLocalCredentialsAllowed } from './auth.local-credentials';

export default class PasswordService {

  private static readonly RATE_LIMIT_MAX_ATTEMPTS = 5;
  /** Wrong reset tokens tried for one account before its outstanding tokens are burned. */
  private static readonly MAX_RESET_GUESSES = 5;
  private static readonly RATE_LIMIT_WINDOW_SECONDS = 60;
  /** 2.3: reset mails per target address per window; beyond it forgotPassword answers success and sends nothing. */
  static readonly MAIL_CAP_MAX = 3;
  static readonly MAIL_CAP_WINDOW_SECONDS = 15 * 60;

  static getMailCapKey(email: string): string {
    return `auth:reset:${email.toLowerCase()}`;
  }

  /**
   * 38-security 1.4 / A-4: a reset token is 32 bytes of CSPRNG output, URL-safe (it travels in the mailed link, never typed), so
   * it cannot be walked like the old 6-digit space. The per-tenant `resetTokenLength` knob no longer shapes it (kept only so
   * stored settings still parse); the failed-guess cap in `resetPassword` stays as a second layer.
   */
  static generateResetToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  static async hashToken(token: string): Promise<string> {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  static getRedisKey(email: string): string {
    return `reset-password:${email.toLowerCase()}`;
  }

  /** auth.10: the token mailed by the previous request, kept valid for its own life (one only, so guessing stays 2-in-10^6). */
  static getPreviousKey(email: string): string {
    return `reset-password-prev:${email.toLowerCase()}`;
  }

  static getRateKey(email: string): string {
    return `reset-password-rate:${email.toLowerCase()}`;
  }

  static async forgotPassword({ email, tenantId, locale }: { email: string; tenantId?: string; locale?: AuthLocale }): Promise<{ resetToken: string }> {
    // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
    await assertLocalCredentialsAllowed();
    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { email } });

    // Non-enumerating: always apply rate-limit against the raw email key, then
    // return success regardless of whether the account exists — only send mail
    // when it does (prevents user-enumeration via timing or error messages).
    const emailKey = email.toLowerCase();
    const tokenKey = PasswordService.getRedisKey(emailKey);
    const rateKey = PasswordService.getRateKey(emailKey);

    const currentRate = await redis.get(rateKey);
    if (currentRate) {
      const rateCount = parseInt(currentRate);
      if (rateCount >= PasswordService.RATE_LIMIT_MAX_ATTEMPTS) throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
      await redis.set(rateKey, (rateCount + 1).toString(), 'EX', PasswordService.RATE_LIMIT_WINDOW_SECONDS);
    } else {
      await redis.set(rateKey, '1', 'EX', PasswordService.RATE_LIMIT_WINDOW_SECONDS);
    }

    if (!user) {
      // Silent success — do not reveal that the account doesn't exist.
      return { resetToken: '' };
    }

    // 38-security 2.3: mail-bomb cap on the TARGET address, whatever IPs ask: past MAIL_CAP_MAX mails per window the request is a
    // silent success (same answer as an unknown account, so it is no oracle) and nothing is sent or minted.
    const mailCount = Number(await redis.incr(PasswordService.getMailCapKey(emailKey)).catch(() => 0)) || 0;
    if (mailCount === 1) await redis.expire(PasswordService.getMailCapKey(emailKey), PasswordService.MAIL_CAP_WINDOW_SECONDS).catch(() => 0);
    if (mailCount > PasswordService.MAIL_CAP_MAX) return { resetToken: '' };

    // auth.10: a new request no longer kills the link the owner already holds (anyone can ask for a reset of any address):
    // the current token moves to the "previous" slot, so the newest and the one before it both work until used or expired.
    const current = await redis.get(tokenKey);
    if (current) {
      const left = Number(await redis.ttl(tokenKey).catch(() => -1));
      if (left > 0) await redis.set(PasswordService.getPreviousKey(emailKey), current, 'EX', left);
    }

    // F.auth.03: the request tenant brands the mail (and sets its link host and token policy) only for its own ACTIVE member;
    // for anyone else the platform (ROOT) does, so a tenant cannot mail a reset link in its own colours to another tenant's people.
    const mailTenantId = await PasswordService.mailTenantFor(tenantId, user.userId);

    // GTH-3: per-tenant reset-token TTL/length.
    const resetPolicy = await AuthPolicyService.getResetPolicy(mailTenantId);
    const resetToken = PasswordService.generateResetToken();
    const hashedToken = await PasswordService.hashToken(resetToken);
    await redis.set(tokenKey, hashedToken, 'EX', resetPolicy.tokenExpirySeconds);

    // GTH-5: route reset mail through the request tenant's provider/branding.
    // PLAT-01: rendered by `notification_mail`, SENT by the dispatcher.
    void PasswordService.sendResetMail(
      mailTenantId,
      { userId: user.userId, email: user.email },
      { resetToken, subject: authEmailSubject('forgot_password', locale) },
    );

    AuditLogService.log({
      tenantId: null,
      actorId: user.userId,
      actorType: 'USER',
      action: AuditActions.AUTH_FORGOT_PASSWORD,
      metadata: { email: user.email },
    }).catch(() => {});

    return { resetToken };
  }

  /** The tenant whose brand, host and reset policy a reset mail for `userId` may use: the request tenant for its ACTIVE member, else ROOT. */
  private static async mailTenantFor(tenantId: string | undefined, userId: string): Promise<string> {
    if (!tenantId || tenantId === ROOT_TENANT_ID) return ROOT_TENANT_ID;
    try {
      const { default: TenantMemberService } = await import('@kuraykaraaslan-labs/tenant_member/server/tenant_member.service');
      const member = await TenantMemberService.getByTenantAndUser({ tenantMemberId: null, tenantId, userId });
      return member?.memberStatus === 'ACTIVE' ? tenantId : ROOT_TENANT_ID;
    } catch {
      return ROOT_TENANT_ID; // unknown membership: the platform brand, never the requester's
    }
  }

  static async resetPassword({ email, resetToken, newPassword, tenantId }: {
    email: string;
    resetToken: string;
    newPassword: string;
    tenantId?: string;
  }): Promise<void> {
    // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
    await assertLocalCredentialsAllowed();
    const user = await UserService.getByEmail(email);
    // An unknown account is answered exactly like a wrong token: the reset form is no oracle for registered addresses.
    if (!user) throw new AppError(AuthMessages.INVALID_TOKEN, 400, ErrorCode.VALIDATION_ERROR);

    const currentKey = PasswordService.getRedisKey(user.email);
    const previousKey = PasswordService.getPreviousKey(user.email);
    const hashedInputToken = await PasswordService.hashToken(resetToken);
    // The newest token, or (auth.10) the one mailed by the request before it.
    const [currentHash, previousHash] = await Promise.all([redis.get(currentKey), redis.get(previousKey)]);
    const tokenKey = currentHash && currentHash === hashedInputToken ? currentKey
      : previousHash && previousHash === hashedInputToken ? previousKey : null;
    if (!currentHash && !previousHash) throw new AppError(AuthMessages.INVALID_TOKEN, 400, ErrorCode.VALIDATION_ERROR);
    if (!tokenKey) {
      // A wrong guess counts against the outstanding tokens: after MAX_RESET_GUESSES they are burned, so the 10^6 space of a
      // short token cannot be walked by someone who outruns the IP limiter.
      const failKey = `reset-password-fail:${user.email.toLowerCase()}`;
      const fails = Number(await redis.incr(failKey).catch(() => 0)) || 0;
      if (fails === 1) await redis.expire(failKey, 3600).catch(() => 0);
      if (fails >= PasswordService.MAX_RESET_GUESSES) {
        await redis.del(currentKey).catch(() => 0);
        await redis.del(previousKey).catch(() => 0);
        await redis.del(failKey).catch(() => 0);
      }
      throw new AppError(AuthMessages.INVALID_TOKEN, 400, ErrorCode.VALIDATION_ERROR);
    }
    const storedHashedToken = hashedInputToken;

    // auth.25: consume the token FIRST, atomically (the DEL that removed the key wins), then do the work. It used to be deleted as
    // the last step, so two concurrent submissions of one code both passed and the later password write won. A reset that fails
    // after this point puts the token back, so the owner can retry (a weak password, a breached one, an outage).
    const consumed = Number(await redis.del(tokenKey)) || 0;
    if (consumed < 1) throw new AppError(AuthMessages.INVALID_TOKEN, 400, ErrorCode.VALIDATION_ERROR);
    try {
      await PasswordService.applyReset(user, newPassword, tenantId);
      // The password changed: the other outstanding token dies with this one.
      await redis.del(tokenKey === currentKey ? previousKey : currentKey).catch(() => 0);
    } catch (err) {
      const { tokenExpirySeconds } = await AuthPolicyService.getResetPolicy(tenantId).catch(() => ({ tokenExpirySeconds: 900 }));
      await redis.set(tokenKey, storedHashedToken, 'EX', tokenExpirySeconds).catch(() => {});
      throw err;
    }

    AuditLogService.log({
      tenantId: tenantId ?? null,
      actorId: user.userId,
      actorType: 'USER',
      action: AuditActions.AUTH_PASSWORD_RESET,
      metadata: { email: user.email },
    }).catch(() => {});

    // GTH-5: route success mail through the request tenant's provider/branding.
    void PasswordService.sendResetSuccessNotice(tenantId ?? ROOT_TENANT_ID, { userId: user.userId, email: user.email });
  }

  /** The work of a reset whose token was already consumed: policy, breach and history checks, the write, the session revocation. */
  private static async applyReset(user: { userId: string; email: string }, newPassword: string, tenantId?: string): Promise<void> {
    // KD-5 / KD-7: enforce password policy + rotation history
    const policy = await AuthPolicyService.getPasswordPolicy(tenantId);
    const policyError = AuthPolicyService.validatePassword(newPassword, policy, { email: user.email });
    if (policyError) throw new AppError(policyError, 422, ErrorCode.VALIDATION_ERROR);

    // Backlog F10 §0. A reset is the MOST important place for this check:
    // somebody resetting a password has often just been told their old one
    // leaked, and letting them pick another leaked one is the failure mode this
    // exists to prevent. Fails open — see `auth.breach-check`.
    const breach = await checkPasswordBreach(newPassword, { enabled: policy.breachCheck });
    if (breach.breached) throw new AppError(AuthMessages.PASSWORD_BREACHED, 422, ErrorCode.VALIDATION_ERROR);

    const history = await UserSecurityService.getPasswordHistory(user.userId);
    for (const oldHash of history) {
      if (await bcrypt.compare(newPassword, oldHash)) {
        throw new AppError(AuthMessages.PASSWORD_REUSED, 422, ErrorCode.VALIDATION_ERROR);
      }
    }

    // GTH-6: per-tenant bcrypt cost.
    const { bcryptCost } = await AuthPolicyService.getCredentialPolicy(tenantId);
    const hashedPassword = await bcrypt.hash(newPassword, bcryptCost);
    const ds = await getDataSource();

    // Wrap password update + history push in a transaction.
    await ds.transaction(async (manager) => {
      await manager.getRepository(UserEntity).update({ userId: user.userId }, { password: hashedPassword });
      await UserSecurityService.pushPasswordHistory(user.userId, hashedPassword, policy.historyCount);
    });

    await UserService.invalidate({ userId: user.userId, email: user.email });
    // F.auth.02: a reset is account recovery, so every session of the account ends here, in every tenant: one a thief holds
    // must not outlive the recovery. Should the revocation fail, the error reaches the caller and the token is put back, so the
    // same token can be used again (fail closed, never "reset done, sessions alive").
    const { default: UserSessionService } = await import('@kuraykaraaslan-labs/user_session/server/user_session.service');
    await UserSessionService.deleteAllSessions(user.userId);
    // 38-security 3.4: recovery also ends every "trusted device": a thief's remembered browser must not skip the risk step-up.
    await UserSecurityService.revokeTrustedDevices(user.userId).catch((err: unknown) => Logger.warn(`reset: trusted devices not revoked: ${err instanceof Error ? err.message : String(err)}`));
  }

  static async validateResetToken({ email, resetToken }: { email: string; resetToken: string }): Promise<boolean> {
    const user = await UserService.getByEmail(email);
    if (!user) return false;

    const hashedInputToken = await PasswordService.hashToken(resetToken);
    const [current, previous] = await Promise.all([
      redis.get(PasswordService.getRedisKey(user.email)), redis.get(PasswordService.getPreviousKey(user.email)),
    ]);
    return (!!current && current === hashedInputToken) || (!!previous && previous === hashedInputToken);
  }

  static async invalidateResetToken({ email }: { email: string }): Promise<void> {
    await redis.del(PasswordService.getRedisKey(email));
    await redis.del(PasswordService.getPreviousKey(email));
  }

  /**
   * The reset LINK, through the dispatcher (PLAT-01).
   *
   * CRITICAL and **mail only**. Critical because a reset link is exactly the
   * credential a preference must never be able to withhold — "email
   * notifications: off" turning into "you can never recover your account" is the
   * failure this urgency level exists to prevent. Mail only because the link is
   * the message: fanning it out would put a live password-reset link in an in-app
   * inbox that is reachable from the session the user has *lost*.
   *
   * Best-effort by design — the caller returns the token to the route either way,
   * and a mail hiccup must not turn a reset request into a 500.
   */
  private static async sendResetMail(
    tenantId: string,
    to: { userId: string; email: string },
    input: { resetToken: string; subject?: string },
  ): Promise<void> {
    try {
      const rendered = await MailTemplatesService.renderForgotPassword({ tenantId, email: to.email, ...input });
      if (!rendered) return;
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
      await NotificationService.notifyCritical(
        tenantId,
        to,
        { event: 'auth.forgot_password', category: 'security', title: rendered.subject, body: rendered.subject, data: { html: rendered.html } },
        { channels: ['mail'] },
      );
    } catch (err: unknown) {
      Logger.warn(`PasswordService: reset mail failed: ${err instanceof Error ? err.message : err}`);
    }
  }

  /**
   * "Your password was reset" — CRITICAL, and on EVERY channel the recipient has.
   *
   * The opposite call from the link above: this one carries no credential, and
   * its whole purpose is to reach somebody whose password was just changed by
   * someone who might not be them. The wider it lands, the better it works.
   */
  private static async sendResetSuccessNotice(tenantId: string, to: { userId: string; email: string }): Promise<void> {
    try {
      const rendered = await MailTemplatesService.renderPasswordResetSuccess({ tenantId, email: to.email });
      if (!rendered) return;
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
      await NotificationService.notifyCritical(
        tenantId,
        to,
        { event: 'auth.password_reset', category: 'security', title: rendered.subject, body: rendered.subject, data: { html: rendered.html } },
      );
    } catch (err: unknown) {
      Logger.warn(`PasswordService: reset success notice failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}
