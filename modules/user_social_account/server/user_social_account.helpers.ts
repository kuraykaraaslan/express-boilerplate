import redis from '@kuraykaraaslan-labs/redis';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import type { SocialAccountProvider } from './user_social_account.enums';

export const SOCIAL_ACCOUNT_CACHE_TTL = env.SESSION_CACHE_TTL ?? (60 * 5);

/** Optional context for tenant-scoped policy / audit / notification. */
export interface SocialLinkContext {
  tenantId?: string;
  expiresAt?: Date | null;
  scopes?: string[];
  notify?: boolean;
}

export async function clearCache(opts: { userId?: string; provider?: SocialAccountProvider; providerId?: string }): Promise<void> {
  const ops: Promise<unknown>[] = [];
  if (opts.userId) ops.push(redis.del(`user_social_account:user:${opts.userId}`));
  if (opts.provider && opts.providerId) {
    ops.push(redis.del(`user_social_account:provider:${opts.provider}:${opts.providerId}`));
  }
  await Promise.all(ops.map((p) => p.catch(() => {})));
}

export async function emitLinkEvent(
  kind: 'linked' | 'unlinked', userId: string, provider: SocialAccountProvider, ctx?: SocialLinkContext,
): Promise<void> {
  try {
    const { default: AuditLogService } = await import('@kuraykaraaslan-labs/audit_log/server/audit_log.service');
    await AuditLogService.log({
      tenantId: ctx?.tenantId ?? null, actorId: userId, actorType: 'USER',
      action: `social_account.${kind}`, severity: 'medium',
      resourceType: 'user_social_account', resourceId: userId, metadata: { provider },
    });
  } catch (e) { Logger.warn(`[social] audit failed: ${e instanceof Error ? e.message : e}`); }
  try {
    const { default: WebhookService } = await import('@kuraykaraaslan-labs/webhook/server/webhook.service');
    await WebhookService.dispatchPlatformEvent(`social_account.${kind}` as never, { userId, provider });
  } catch (e) { Logger.warn(`[social] webhook failed: ${e instanceof Error ? e.message : e}`); }
}

export async function notifyUser(userId: string, provider: SocialAccountProvider, kind: 'linked' | 'unlinked', tenantId: string): Promise<void> {
  try {
    const { default: UserService } = await import('@kuraykaraaslan-labs/user/server/user.service');
    const user = await UserService.getById(userId).catch(() => null);
    if (!user?.email) return;
    // Through the dispatcher (PLAT-01), CRITICAL: an identity provider being
    // attached to or detached from an account is an account-TAKEOVER signal.
    // Whoever did it would love the victim's mail preference to silence this.
    const { default: NotificationService } = await import('@kuraykaraaslan-labs/notification/server/notification.service');
    const verb = kind === 'linked' ? 'linked to' : 'unlinked from';
    await NotificationService.notifyCritical(
      tenantId,
      { userId, email: user.email },
      {
        event: `user_social_account.${kind}`,
        category: 'security',
        title: `A social account was ${verb} your account`,
        body: `The ${provider} provider was ${verb} your account.`,
        data: {
          html: `<p>The <strong>${provider}</strong> provider was ${verb} your account. If this wasn't you, secure your account immediately.</p>`,
        },
      },
    );
  } catch (e) { Logger.warn(`[social] notify failed: ${e instanceof Error ? e.message : e}`); }
}
