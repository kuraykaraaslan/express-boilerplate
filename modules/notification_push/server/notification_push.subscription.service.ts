import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { getMaxSubscriptionsPerUser } from './notification_push.settings-policy';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { PushSubscription as PushSubscriptionEntity } from './entities/push_subscription.entity';
import NotificationPushMessages from './notification_push.messages';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { PUSH_CACHE_TTL, cacheKeyForUser, clearCacheForUser } from './notification_push.config';
import type { RegisterPushTokenInput } from './notification_push.dto';

export async function getSubscriptionsForUser(
  tenantId: string,
  userId: string,
): Promise<PushSubscriptionEntity[]> {
  const cacheKey = cacheKeyForUser(tenantId, userId);
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached) {
    try {
      const hit = JSON.parse(cached) as PushSubscriptionEntity[];
      // The cache deliberately omits Web Push keys, so a cached browser subscription cannot be
      // sent to. Token-addressed rows (Expo) need nothing more and are served from cache;
      // anything holding Web Push keys goes back to the database.
      if (hit.every((sub) => sub.provider && sub.provider !== 'webpush')) return hit;
    } catch { await redis.del(cacheKey).catch(() => {}); }
  }

  return singleFlight(cacheKey, async () => {
    const subs = await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo
      .find({ where: { tenantId, userId } }));
    const safeForCache = subs.map(({ id, endpoint, userId: uid, provider, categories }) => ({ id, endpoint, userId: uid, provider, categories }));
    await redis.setex(cacheKey, jitter(PUSH_CACHE_TTL), JSON.stringify(safeForCache)).catch(() => {});
    return subs;
  });
}

export async function subscribe(
  tenantId: string,
  userId: string,
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  opts?: { categories?: string[]; consent?: boolean },
): Promise<void> {
  // Settings are read BEFORE the block (they are another module's read); the
  // lookup + write is one tenant-scoped block; the cache is cleared after it.
  const max = await getMaxSubscriptionsPerUser(tenantId);
  await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, async (repo) => {
    const existing = await repo.findOne({
      where: { tenantId, endpoint: subscription.endpoint },
    });
    if (existing) {
      // Ownership verification: an endpoint already owned by a different user
      // cannot be silently re-bound without going through unsubscribe first.
      if (existing.userId !== userId) {
        throw new AppError(NotificationPushMessages.SUBSCRIPTION_OWNERSHIP_MISMATCH, 409, ErrorCode.CONFLICT);
      }
      await repo.update(
        { tenantId, endpoint: subscription.endpoint },
        {
          userId,
          p256dh: subscription.keys.p256dh,
          auth: subscription.keys.auth,
          ...(opts?.categories !== undefined ? { categories: opts.categories } : {}),
          ...(opts?.consent ? { consentAt: new Date() } : {}),
        }
      );
      return;
    }
    // Per-user subscription cap (setting pushMaxSubscriptionsPerUser, 1..100, default 10).
    const count = await repo.count({ where: { tenantId, userId } });
    if (count >= max) {
      throw new AppError(NotificationPushMessages.SUBSCRIPTION_LIMIT_REACHED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }
    await repo.save(repo.create({
      tenantId,
      userId,
      endpoint: subscription.endpoint,
      p256dh: subscription.keys.p256dh,
      auth: subscription.keys.auth,
      categories: opts?.categories ?? null,
      consentAt: opts?.consent ? new Date() : null,
    }));
  });
  await clearCacheForUser(tenantId, userId);
}

export async function unsubscribe(tenantId: string, userId: string): Promise<void> {
  await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo.delete({ tenantId, userId }));
  await clearCacheForUser(tenantId, userId);
}

/**
 * Remove one subscription by endpoint. Pass `userId` to confine it to that user's own
 * row: without it any member could delete anyone's endpoint in the tenant, which the
 * HTTP route used to allow.
 */
export async function unsubscribeByEndpoint(tenantId: string, endpoint: string, userId?: string): Promise<void> {
  const where = userId ? { tenantId, endpoint, userId } : { tenantId, endpoint };
  const existing = await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, async (repo) => {
    const row = await repo.findOne({ where });
    await repo.delete(where);
    return row;
  });
  if (existing) await clearCacheForUser(tenantId, existing.userId);
}

/**
 * Register (or refresh) a native-app push token for this user in this tenant.
 *
 *  - The token is the address, so a token already on file is RE-BOUND to the caller: a phone
 *    handed to another person signs in under a new account, and refusing would leave the
 *    previous owner's row swallowing the new owner's notifications. (Web Push keeps its
 *    ownership check: a browser endpoint is bound to the key pair the subscriber holds.)
 *  - A new token for a `deviceId` this user already registered replaces the old row — Expo
 *    rotates tokens, and rows must not pile up behind a reinstall.
 *  - The per-user cap (`pushMaxSubscriptionsPerUser`) applies to genuinely new devices.
 */
export async function registerDeviceToken(
  tenantId: string,
  userId: string,
  input: RegisterPushTokenInput,
  userSessionId?: string,
): Promise<void> {
  const max = await getMaxSubscriptionsPerUser(tenantId);
  const fields = {
    provider: input.provider,
    platform: input.platform,
    appVersion: input.appVersion ?? null,
    deviceId: input.deviceId ?? null,
    userSessionId: userSessionId ?? null,
    p256dh: null,
    auth: null,
    consentAt: new Date(),
    ...(input.categories !== undefined ? { categories: input.categories } : {}),
  };

  await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, async (repo) => {
    const byToken = await repo.findOne({ where: { tenantId, endpoint: input.token } });
    if (byToken) {
      // notification_push.01 (fixed 2026-10-20): a token registered by ANOTHER member is not re-bound to the caller (409): a member who
      // learnt someone's token took over their device's notifications. A device handed to another person is re-registered after the
      // previous owner signs out (their session's rows are deleted then, see notification_push.session-revoked).
      if (byToken.userId && byToken.userId !== userId) {
        throw new AppError(NotificationPushMessages.SUBSCRIPTION_OWNERSHIP_MISMATCH, 409, ErrorCode.CONFLICT);
      }
      await repo.update({ tenantId, endpoint: input.token }, { ...fields, userId });
      return;
    }

    if (input.deviceId) {
      const byDevice = await repo.findOne({ where: { tenantId, userId, provider: input.provider, deviceId: input.deviceId } });
      if (byDevice) {
        await repo.update({ tenantId, id: byDevice.id }, { ...fields, endpoint: input.token });
        return;
      }
    }

    const count = await repo.count({ where: { tenantId, userId } });
    if (count >= max) {
      throw new AppError(NotificationPushMessages.SUBSCRIPTION_LIMIT_REACHED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
    }
    await repo.save(repo.create({ tenantId, userId, endpoint: input.token, ...fields }));
  });

  await clearCacheForUser(tenantId, userId);
}

/**
 * Remove this user's own token(s), by install id or token. Always confined to `userId`:
 * one member cannot unregister another's device.
 */
export async function unregisterDeviceToken(
  tenantId: string,
  userId: string,
  by: { deviceId?: string; token?: string },
): Promise<void> {
  await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, async (repo) => {
    if (by.token) await repo.delete({ tenantId, userId, endpoint: by.token });
    if (by.deviceId) await repo.delete({ tenantId, userId, deviceId: by.deviceId });
  });
  await clearCacheForUser(tenantId, userId);
}

/**
 * Change the categories of this user's own token (by install id or token) without re-registering.
 * Confined to `userId`. Returns how many rows changed (0 = nothing of theirs matched).
 */
export async function updateDeviceTokenCategories(
  tenantId: string,
  userId: string,
  by: { deviceId?: string; token?: string },
  categories: string[],
): Promise<number> {
  let changed = 0;
  await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, async (repo) => {
    const where = by.token ? { tenantId, userId, endpoint: by.token } : { tenantId, userId, deviceId: by.deviceId };
    const res = await repo.update(where, { categories });
    changed = res.affected ?? 0;
  });
  if (changed) await clearCacheForUser(tenantId, userId);
  return changed;
}
