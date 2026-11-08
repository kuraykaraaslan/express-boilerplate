import 'reflect-metadata';
import { Redis } from 'ioredis';
import redis, { createRedisConnection } from '@kuraykaraaslan-labs/redis';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantMember } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import { v4 as uuid } from 'uuid';
import { NotificationSchema } from './notification_inapp.types';
import type { Notification, NotificationPayload } from './notification_inapp.types';
import { actionFromData, internalPath } from './notification_inapp.target';
import NotificationPushService from '@kuraykaraaslan-labs/notification_push/server/notification_push.service';
import type { UserPreferences } from '@kuraykaraaslan-labs/user_preferences/server/user_preferences.types';
import Logger from '@kuraykaraaslan-labs/logger';
import type { UserIdInput } from '@kuraykaraaslan-labs/user/server/user.ids';
import {
  getNotificationPrefs,
  resolveRetentionTtl,
  isInQuietHours,
  isCategoryOptedOut,
} from './notification_inapp.helpers';

/**
 * NotificationInAppService is fully tenant-scoped. Redis keys and pub/sub
 * channels include the tenantId so the same userId in tenant A can never
 * see notifications addressed to that user in tenant B.
 *
 * Key formats:
 *   - inbox hash:   notifications:{tenantId}:{userId}
 *   - read set:     notifications_read:{tenantId}:{userId}
 *   - pub/sub:      notifications:tenant:{tenantId}:user:{userId}
 */
export default class NotificationInAppService {
  private static notifKey = (tenantId: string, userId: string) =>
    `notifications:${tenantId}:${userId}`;
  private static readKey = (tenantId: string, userId: string) =>
    `notifications_read:${tenantId}:${userId}`;
  static channel = (tenantId: string, userId: string) =>
    `notifications:tenant:${tenantId}:user:${userId}`;

  static MAX_PER_USER = 50;
  static TTL = 7 * 24 * 60 * 60;
  private static optOutKey = (tenantId: string, userId: string) =>
    `notifications_optout:${tenantId}:${userId}`;

  static createSubscriber(): Redis {
    return createRedisConnection();
  }

  /**
   * Whether the user has opted out of a notification category. Prefers the
   * canonical user_preferences per-category opt-ins; falls back to this module's
   * local Redis opt-out set (which also covers operational categories that
   * user_preferences does not model). A marketing-consent category is delivered
   * only on an explicit opt-in, so it fails CLOSED when the preferences are
   * `null` or unreadable; operational categories (and the push channel) still
   * fail open (06-user 1.3).
   *
   * @param prefs pre-loaded preferences to reuse (`undefined` = load on demand,
   *              `null` = unavailable: consent categories are held back). Lets
   *              `push()` read prefs once.
   */
  static async isOptedOut(
    tenantId: string,
    userId: string,
    type?: string | null,
    prefs?: UserPreferences | null,
  ): Promise<boolean> {
    return isCategoryOptedOut(this.optOutKey(tenantId, userId), userId, type, prefs);
  }

  static async setCategoryOptOut(tenantId: string, userId: string, type: string, optedOut: boolean): Promise<void> {
    const key = this.optOutKey(tenantId, userId);
    if (optedOut) await redis.sadd(key, type).catch(() => {});
    else await redis.srem(key, type).catch(() => {});
  }

  /**
   * `UserIdInput`, not `string`: a plain uuid passes freely, but an id branded
   * into another space is rejected at compile time. An in-app notification is
   * addressed to a Redis key — an id from the wrong space writes an inbox nobody
   * reads and returns successfully, which is how the leave decision "notified"
   * employees for months (audit 2026-08, DEP-03).
   */
  static async push(
    tenantId: string,
    userId: UserIdInput,
    data: NotificationPayload
  ): Promise<Notification | null> {
    // Read the recipient's canonical notification opt-ins once (best-effort).
    const prefs = await getNotificationPrefs(userId);

    // Respect the user's per-category opt-out (in-app + push both suppressed).
    if (await this.isOptedOut(tenantId, userId, data.type, prefs)) return null;

    const notification = await this.pushRaw(tenantId, userId, data);

    // Fan out to web-push unless the caller disabled it, the recipient turned
    // off the push channel in their preferences, or we're in quiet hours.
    const pushChannelEnabled = prefs?.pushNotifications !== false;
    const fanout =
      data.pushFanout !== false && pushChannelEnabled && !(await isInQuietHours(tenantId));
    if (fanout) {
      NotificationPushService.sendToUser(tenantId, userId, {
        title: data.title,
        body: data.message,
        url: data.path ?? '/',
        tag: data.type ?? undefined,
      }).catch((err) => Logger.warn('Push notification delivery failed', err));
    }

    return notification;
  }

  /**
   * Store + broadcast an in-app item and nothing else — no preference check, no
   * quiet hours, no push fan-out.
   *
   * This is the seam the `notification:channel` contribution uses. Under the
   * core dispatcher (PLAT-01) policy is resolved once, up front, for every
   * channel at the same time, and web push is a sibling contribution; calling
   * `push()` from there would apply the policy twice and deliver the push twice.
   * `push()` keeps its own checks for the direct callers that still exist.
   */
  static async pushRaw(
    tenantId: string,
    userId: UserIdInput,
    data: NotificationPayload
  ): Promise<Notification> {
    const notification: Notification = {
      notificationId: uuid(),
      title: data.title,
      message: data.message,
      // the page the bell opens: an internal app path only; an action only in its stored shape (else the row would not parse)
      path: internalPath(data.path),
      type: data.type ?? null,
      action: actionFromData(data.action),
      expiresAt: data.expiresAt ?? null,
      ...(typeof data.ref === 'string' && data.ref ? { ref: data.ref.slice(0, 200) } : {}),
      isRead: false,
      createdAt: new Date().toISOString(),
    };
    const meta = scalarMeta(data.meta);
    if (meta) notification.meta = meta;

    const key = this.notifKey(tenantId, userId);
    await redis.hset(key, notification.notificationId, JSON.stringify(notification));
    await redis.expire(key, await resolveRetentionTtl(tenantId, this.TTL));

    const all = await this.getAll(tenantId, userId);
    if (all.length > this.MAX_PER_USER) {
      const oldest = all
        .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
        .slice(0, all.length - this.MAX_PER_USER);
      for (const n of oldest) {
        await redis.hdel(key, n.notificationId);
      }
    }

    await redis.publish(this.channel(tenantId, userId), JSON.stringify(notification));

    return notification;
  }

  static async pushToUsers(
    tenantId: string,
    userIds: UserIdInput[],
    data: NotificationPayload
  ): Promise<void> {
    await Promise.all(userIds.map((id) => this.push(tenantId, id, data)));
  }

  static async pushToRole(
    tenantId: string,
    role: string,
    data: NotificationPayload
  ): Promise<void> {
    // The membership lookup runs inside the chokepoint's transaction
    // (docs/phases/10-db Faz 3); the Redis push fan-out below runs after it returns,
    // per db.context.ts's own "keep the block short" rule.
    const members = await withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.find({
      where: { tenantId, memberRole: role, memberStatus: 'ACTIVE' },
      select: ['userId'],
    }));
    await Promise.all(members.map((m) => this.push(tenantId, m.userId, data)));
  }

  static async pushToAdmins(tenantId: string, data: NotificationPayload): Promise<void> {
    await this.pushToRole(tenantId, 'ADMIN', data);
  }

  /**
   * Broadcast to every active member of {tenantId}. Scoped to a single
   * tenant — there is no cross-tenant broadcast by design.
   */
  static async pushToAll(tenantId: string, data: NotificationPayload): Promise<void> {
    const members = await withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.find({
      where: { tenantId, memberStatus: 'ACTIVE' },
      select: ['userId'],
    }));
    await Promise.all(members.map((m) => this.push(tenantId, m.userId, data)));
  }

  static async getAll(tenantId: string, userId: string): Promise<Notification[]> {
    const raw = await redis.hgetall(this.notifKey(tenantId, userId));
    if (!raw) return [];

    const readIds = await this.getReadIds(tenantId, userId);
    const now = Date.now();
    const expiredIds: string[] = [];
    const notifications: Notification[] = Object.values(raw).flatMap((json) => {
      const parsed = NotificationSchema.safeParse(JSON.parse(json));
      if (!parsed.success) {
        Logger.warn('notification_inapp: skipping malformed entry', parsed.error);
        return [];
      }
      const n = parsed.data;
      // Drop (and lazily purge) notifications past their explicit expiry.
      if (n.expiresAt && new Date(n.expiresAt).getTime() <= now) {
        expiredIds.push(n.notificationId);
        return [];
      }
      return [{ ...n, isRead: readIds.has(n.notificationId) }];
    });
    if (expiredIds.length) {
      redis.hdel(this.notifKey(tenantId, userId), ...expiredIds).catch(() => {});
    }

    return notifications.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  static async unreadCount(tenantId: string, userId: string): Promise<number> {
    const all = await this.getAll(tenantId, userId);
    return all.filter((n) => !n.isRead).length;
  }

  static async markAsRead(
    tenantId: string,
    userId: string,
    notificationId: string
  ): Promise<void> {
    const key = this.readKey(tenantId, userId);
    await redis.sadd(key, notificationId);
    // The feed's own retention (inAppRetentionDays): a shorter TTL here would turn read items unread again.
    await redis.expire(key, await resolveRetentionTtl(tenantId, this.TTL));
  }

  static async markAllAsRead(tenantId: string, userId: string): Promise<void> {
    const all = await this.getAll(tenantId, userId);
    if (!all.length) return;
    const key = this.readKey(tenantId, userId);
    await redis.sadd(key, ...all.map((n) => n.notificationId));
    await redis.expire(key, await resolveRetentionTtl(tenantId, this.TTL));
  }

  static async deleteOne(
    tenantId: string,
    userId: string,
    notificationId: string
  ): Promise<void> {
    await Promise.all([
      redis.hdel(this.notifKey(tenantId, userId), notificationId),
      redis.srem(this.readKey(tenantId, userId), notificationId),
    ]);
  }

  /**
   * Takes back this user's entries the producer stored under `ref` and that are still unread (a withdrawn announcement:
   * what was read stays, it was seen). Returns how many went.
   */
  static async recall(tenantId: string, userId: string, ref: string): Promise<number> {
    const all = await this.getAll(tenantId, userId);
    const gone = all.filter((n) => n.ref === ref && !n.isRead).map((n) => n.notificationId);
    if (gone.length) await redis.hdel(this.notifKey(tenantId, userId), ...gone);
    return gone.length;
  }

  static async clearAll(tenantId: string, userId: string): Promise<void> {
    await Promise.all([
      redis.del(this.notifKey(tenantId, userId)),
      redis.del(this.readKey(tenantId, userId)),
    ]);
  }

  private static async getReadIds(tenantId: string, userId: string): Promise<Set<string>> {
    const members = await redis.smembers(this.readKey(tenantId, userId));
    return new Set(members);
  }
}

/** At most this many `meta` keys are kept on a feed item. */
const META_MAX_KEYS = 12;
/** A `meta` string longer than this is cut: it is a fact for wording, not a body. */
const META_MAX_STRING = 200;

/**
 * The scalar part of a sender's `meta` (strings, numbers, booleans, null), bounded in size; null when nothing is left.
 * Anything nested is dropped: the feed item is stored per user in Redis and sent down the stream as is.
 */
export function scalarMeta(meta: unknown): Record<string, string | number | boolean | null> | null {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta as Record<string, unknown>)) {
    if (Object.keys(out).length >= META_MAX_KEYS) break;
    if (typeof v === 'string') out[k] = v.slice(0, META_MAX_STRING);
    else if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean' || v === null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
