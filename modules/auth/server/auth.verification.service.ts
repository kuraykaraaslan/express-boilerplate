import 'reflect-metadata';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import MailAccountTemplatesService from '@kuraykaraaslan-labs/notification_mail/server/notification_mail.account-templates.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AuditActions } from '@kuraykaraaslan-labs/audit_log/server/audit_log.enums';
import AuthMessages from './auth.messages';
import AuthPolicyService from './auth.policy.service';
import { authEmailSubject } from './auth.i18n';
import type { AuthLocale } from './dictionaries';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { liftSignupHold } from './auth.signup-protection';

/** A bcrypt hash of a random value nobody knows: compared against when the address has no account (constant timing). */
const DUMMY_PASSWORD_HASH = '$2b$10$CwTycUXWue0Thq9StjUM0uJ8.4E5Rz8xmF3S0Q8qT1Xv8e5wq4aWi';

export default class AuthVerificationService {

  // GTH-3: env values are the fallback default; per-tenant email-verify TTL and
  // rate-limit are resolved at runtime via AuthPolicyService.getEmailVerifyPolicy.

  private static getEmailVerifyKey(userId: string): string {
    return `email:verify:${userId}`;
  }

  private static getEmailVerifyRateKey(userId: string): string {
    return `email:verify:rate:${userId}`;
  }

  static async logout({ accessToken }: { accessToken: string }): Promise<void> {}

  /**
   * How long the account's newest verification link stays valid, in ms (0: none is stored). Phase 55 02.6 (D55-68): the sign-up hold ends
   * when the link it rests on does.
   */
  static async verificationLinkRemainingMs(userId: string): Promise<number> {
    const ms = Number(await redis.pttl(AuthVerificationService.getEmailVerifyKey(userId)));
    return Number.isFinite(ms) && ms > 0 ? ms : 0;
  }

  static async sendEmailVerification({ userId, email, name, tenantId, locale }: {
    userId: string; email: string; name?: string; tenantId?: string; locale?: AuthLocale;
  }): Promise<void> {
    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { userId } });
    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (user.emailVerifiedAt) throw new AppError(AuthMessages.EMAIL_ALREADY_VERIFIED, 409, ErrorCode.CONFLICT);

    const rateKey = AuthVerificationService.getEmailVerifyRateKey(userId);
    if (await redis.get(rateKey)) throw new AppError(AuthMessages.RATE_LIMIT_EXCEEDED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);

    // GTH-3: per-tenant email-verification TTL + rate-limit window.
    const verifyPolicy = await AuthPolicyService.getEmailVerifyPolicy(tenantId);

    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');

    const verifyKey = AuthVerificationService.getEmailVerifyKey(userId);
    await redis.set(verifyKey, hashedToken, 'EX', verifyPolicy.ttlSeconds);
    await redis.set(rateKey, '1', 'EX', verifyPolicy.rateLimitSeconds);

    // GTH-5: route verification mail through the request tenant's provider/branding.
    // PLAT-01: `notification_mail` renders, the DISPATCHER sends. Critical, because
    // an unverified account is blocked until this arrives — a quiet-hours or
    // digest preference must not hold it.
    const rendered = await MailAccountTemplatesService.renderVerifyEmail({
      tenantId, email, name, verifyToken: rawToken, subject: authEmailSubject('verify_email', locale),
    });
    if (!rendered) throw new AppError(AuthMessages.EMAIL_SEND_FAILED, 500, ErrorCode.INTERNAL_ERROR);
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    await NotificationService.notifyCritical(
      tenantId ?? ROOT_TENANT_ID,
      { userId, email },
      {
        event: 'auth.verify_email',
        category: 'security',
        title: rendered.subject,
        body: rendered.subject,
        data: { html: rendered.html },
      },
    );
    Logger.info(`Email verification sent for user ${userId}`);
  }

  /**
   * Verify an email WITHOUT a session (the link opened in a browser that is not signed in, or a tenant that will not sign
   * an unverified account in): the link's token AND the account's password. The token proves the inbox, the password
   * proves the account: somebody who registered with another person's address cannot have that person's click verify
   * it (the owner of the inbox does not know the password). Every failure is the same INVALID_VERIFICATION_TOKEN: an
   * unknown address, a wrong password, a wrong, expired or missing token, an address already verified. Anything finer
   * would be an anonymous password check (a verified account answering "already verified" only to the right password).
   * An unknown address costs a bcrypt compare too, so the timing does not tell whether an account exists either.
   */
  static async verifyEmailWithPassword({ email, password, token }: { email: string; password: string; token: string }): Promise<void> {
    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { email: email.trim().toLowerCase() } });
    const refused = () => new AppError(AuthMessages.INVALID_VERIFICATION_TOKEN, 400, ErrorCode.VALIDATION_ERROR);
    const ok = await bcrypt.compare(password, user?.password ?? DUMMY_PASSWORD_HASH).catch(() => false);
    if (!user || !ok) throw refused();
    try {
      await AuthVerificationService.verifyEmail({ userId: user.userId, token });
    } catch {
      throw refused();
    }
  }

  static async verifyEmail({ userId, token }: { userId: string; token: string }): Promise<void> {
    const ds = await getDataSource();
    const repo = ds.getRepository(UserEntity);
    const user = await repo.findOne({ where: { userId } });
    if (!user) throw new AppError(AuthMessages.USER_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    if (user.emailVerifiedAt) throw new AppError(AuthMessages.EMAIL_ALREADY_VERIFIED, 409, ErrorCode.CONFLICT);

    const verifyKey = AuthVerificationService.getEmailVerifyKey(userId);
    const storedHash = await redis.get(verifyKey);
    if (!storedHash) throw new AppError(AuthMessages.VERIFICATION_TOKEN_EXPIRED, 400, ErrorCode.VALIDATION_ERROR);

    const inputHash = crypto.createHash('sha256').update(token).digest('hex');
    if (inputHash !== storedHash) throw new AppError(AuthMessages.INVALID_VERIFICATION_TOKEN, 400, ErrorCode.VALIDATION_ERROR);

    await repo.update({ userId }, { emailVerifiedAt: new Date() });
    await redis.del(verifyKey);
    await redis.del(AuthVerificationService.getEmailVerifyRateKey(userId));

    AuditLogService.log({
      tenantId: null, actorId: userId, actorType: 'USER',
      action: AuditActions.AUTH_EMAIL_VERIFIED, metadata: { userId },
    }).catch(() => {});
    // Phase 55 02.6: an account the firewall held until its address was verified (auth.signup_hold) is released now. Best effort, never
    // throws: the verification stands, and a hold that could not be lifted ends with its TTL.
    await liftSignupHold(userId);
    Logger.info(`Email verified for user ${userId}`);
  }
}
