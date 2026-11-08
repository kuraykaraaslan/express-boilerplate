import 'reflect-metadata';
import crypto from 'crypto';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import TenantMemberService from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.service';
import MailAccountTemplatesService from '@kuraykaraaslan-labs/notification_mail/server/notification_mail.account-templates.service';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { SafeUserSchema, type SafeUser } from '@kuraykaraaslan-labs/user/server/user.types';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import AuthMessages from './auth.messages';
import { authEmailSubject } from './auth.i18n';
import type { AuthLocale } from './dictionaries';
import { AUTH_SETTING_KEYS, MAGIC_LINK_DEFAULTS } from './auth.setting.keys';
import { assertLocalCredentialsAllowed } from './auth.local-credentials';

/**
 * Passwordless email login (backlog F10 §1).
 *
 * ## The security model, in one place
 *
 * - **Silent on every failure.** `request()` returns the same nothing whether
 *   the address has an account, is a member of this tenant, is suspended, or
 *   the feature is off. A different answer for "no such user" is an account
 *   enumeration oracle — the same reason `forgotPassword` says nothing.
 * - **Single use, short life.** The token is 32 random bytes; only its SHA-256
 *   is stored, in Redis, under a short TTL, and `consume()` deletes the key
 *   before it does anything else. A replayed link is an expired link.
 * - **A first factor, not an MFA bypass.** `consume()` hands off to the same
 *   `createSession` the password path uses, so a tenant that requires TOTP
 *   still gets the OTP step. The link proves the address; it does not prove
 *   the second factor.
 * - **Rate limited per address**, so the mailbox cannot be flooded and the
 *   endpoint cannot be turned into a mailer.
 */
/** auth.18: the ceiling of a magic link's life, whatever a tenant sets. */
const MAGIC_LINK_MAX_TTL_SECONDS = 24 * 3600;

export default class AuthMagicLinkService {
  private static readonly RATE_KEY = (emailHash: string) => `magiclink:rate:${emailHash}`;
  private static readonly TOKEN_KEY = (tokenHash: string) => `magiclink:tok:${tokenHash}`;

  private static sha256(input: string): string {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /** Resolve the three magic-link settings, tenant over system over default (the TTL capped at MAGIC_LINK_MAX_TTL_SECONDS). */
  private static async policy(tenantId?: string): Promise<{ enabled: boolean; ttlSeconds: number; rateLimitSeconds: number }> {
    const keys = [
      AUTH_SETTING_KEYS.MAGIC_LINK_ENABLED,
      AUTH_SETTING_KEYS.MAGIC_LINK_TTL_SECONDS,
      AUTH_SETTING_KEYS.MAGIC_LINK_RATE_LIMIT_SECONDS,
    ];
    const system = await SettingService.getByKeys(ROOT_TENANT_ID, keys).catch(() => ({} as Record<string, string>));
    const tenant = tenantId && tenantId !== ROOT_TENANT_ID
      ? await SettingService.getByKeys(tenantId, keys).catch(() => ({} as Record<string, string>))
      : {};
    const pick = (k: string) => (tenant as Record<string, string>)[k] ?? (system as Record<string, string>)[k];
    const int = (raw: string | undefined, fallback: number) => {
      const n = raw != null ? Number.parseInt(raw, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : fallback;
    };
    const enabledRaw = pick(AUTH_SETTING_KEYS.MAGIC_LINK_ENABLED);
    return {
      enabled: enabledRaw != null ? enabledRaw === 'true' : MAGIC_LINK_DEFAULTS.enabled,
      // auth.18: a link signs in a GLOBAL account, so no tenant (nor the platform) keeps one alive past 24 hours.
      ttlSeconds: Math.min(MAGIC_LINK_MAX_TTL_SECONDS, int(pick(AUTH_SETTING_KEYS.MAGIC_LINK_TTL_SECONDS), MAGIC_LINK_DEFAULTS.ttlSeconds)),
      rateLimitSeconds: int(pick(AUTH_SETTING_KEYS.MAGIC_LINK_RATE_LIMIT_SECONDS), MAGIC_LINK_DEFAULTS.rateLimitSeconds),
    };
  }

  /**
   * Email a one-time sign-in link — or, on any reason it should not, do nothing
   * and say nothing. Never throws for a "no" that a caller could observe.
   */
  static async request(input: {
    email: string;
    tenantId: string;
    ipAddress?: string;
    userAgent?: string;
    locale?: AuthLocale;
  }): Promise<void> {
    // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
    await assertLocalCredentialsAllowed();
    const email = input.email.trim().toLowerCase();
    const policy = await this.policy(input.tenantId);
    if (!policy.enabled) return;

    const emailHash = this.sha256(email);
    const rateKey = this.RATE_KEY(emailHash);
    if (await redis.get(rateKey).catch(() => null)) return; // asked again too soon — silent

    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { email } }).catch(() => null);
    if (!user) return;
    // Suspended / not-yet-active accounts do not get a link.
    if (user.userStatus && user.userStatus !== 'ACTIVE') return;

    const member = await TenantMemberService.getByTenantAndUser({
      tenantMemberId: null, tenantId: input.tenantId, userId: user.userId,
    }).catch(() => null);
    if (!member || member.memberStatus !== 'ACTIVE') return;

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = this.sha256(rawToken);
    await redis.set(this.TOKEN_KEY(tokenHash), user.userId, 'EX', policy.ttlSeconds);
    await redis.set(rateKey, '1', 'EX', policy.rateLimitSeconds);

    const rendered = await MailAccountTemplatesService.renderMagicLinkEmail({
      email: user.email, tenantId: input.tenantId, token: rawToken,
      subject: authEmailSubject('magic_link', input.locale),
    });
    if (rendered) {
      // Critical: an account-access credential, exempt from digest/quiet-hours
      // preferences the same way OTP and password-reset mail are (PLAT-01: the
      // domain decides, the dispatcher sends).
      const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
      await NotificationService.notifyCritical(
        input.tenantId,
        { userId: user.userId, email: user.email },
        {
          event: 'auth.magic_link',
          category: 'security',
          title: rendered.subject,
          body: rendered.subject,
          data: { html: rendered.html },
        },
        { channels: ['mail'] },
      ).catch((err: unknown) => Logger.error(`[auth.magic-link] send failed: ${err}`));
    }

    AuditLogService.log({
      tenantId: input.tenantId,
      actorType: 'USER',
      actorId: user.userId,
      action: 'auth.magic_link.requested',
      resourceType: 'User',
      resourceId: user.userId,
      metadata: { ipAddress: input.ipAddress, userAgent: input.userAgent },
    }).catch(() => {});
  }

  /**
   * Validate a token and return the user it belongs to. Deletes the token
   * first, so a second use of the same link is an expired link. The ROUTE
   * creates the session (running MFA) and sets cookies — the same handoff the
   * password login uses.
   */
  static async consume(input: { token: string; tenantId: string }): Promise<SafeUser> {
    // FID-07: on a deployment whose people log in through Fleet ID, no local credential is used or created (auth:local_credentials_policy).
    await assertLocalCredentialsAllowed();
    const tokenHash = this.sha256(input.token);
    const key = this.TOKEN_KEY(tokenHash);
    const userId = await redis.get(key).catch(() => null);
    // One use: gone the moment it is read, whatever happens next. auth.11: only the click whose DEL removed the key wins; a
    // concurrent second click that read the same userId before the delete is refused like a used link.
    const consumed = userId ? Number(await redis.del(key).catch(() => 0)) || 0 : 0;
    if (!userId || consumed < 1) throw new AppError(AuthMessages.MAGIC_LINK_INVALID, 400, ErrorCode.VALIDATION_ERROR);

    const ds = await getDataSource();
    const user = await ds.getRepository(UserEntity).findOne({ where: { userId } });
    if (!user || (user.userStatus && user.userStatus !== 'ACTIVE')) {
      throw new AppError(AuthMessages.MAGIC_LINK_INVALID, 400, ErrorCode.VALIDATION_ERROR);
    }

    const member = await TenantMemberService.getByTenantAndUser({
      tenantMemberId: null, tenantId: input.tenantId, userId: user.userId,
    }).catch(() => null);
    if (!member || member.memberStatus !== 'ACTIVE') {
      throw new AppError(AuthMessages.MAGIC_LINK_INVALID, 400, ErrorCode.VALIDATION_ERROR);
    }

    AuditLogService.log({
      tenantId: input.tenantId,
      actorType: 'USER',
      actorId: user.userId,
      action: 'auth.magic_link.consumed',
      resourceType: 'User',
      resourceId: user.userId,
      metadata: {},
    }).catch(() => {});

    // Hand back the SAME sanitized shape the password login passes to
    // `createSession` — never the raw entity with its password hash.
    return SafeUserSchema.parse(user);
  }
}
