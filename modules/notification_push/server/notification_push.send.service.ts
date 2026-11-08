import 'reflect-metadata';
import { In } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { getPushProviderKey } from './notification_push.settings-policy';
import { listExternalContributions } from '@kuraykaraaslan-labs/common/server/external-extensions';
import { PushSubscription as PushSubscriptionEntity } from './entities/push_subscription.entity';
import { TenantMember } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
import Logger from '@kuraykaraaslan-labs/logger';
import { PushPayload, isPushEnabled, clearCacheForUser } from './notification_push.config';
import { getSubscriptionsForUser } from './notification_push.subscription.service';
import { wantsCategory, isWithinQuietHours, recordOutcome } from './notification_push.metrics.service';
import { RedisIdempotencyService } from '@kuraykaraaslan-labs/redis_idempotency';
import { IsolatedPushProvider } from './providers/isolated.provider';
import { sendExpo } from './notification_push.expo';
import { trackTicket } from './notification_push.expo-receipts';
import { endpointResolvesPublic } from './notification_push.endpoint-guard';

const PUSH_PROVIDER_POINT = 'push:provider';

/**
 * Resolve the tenant's push backend. Backends are SANDBOXED community plugins (the
 * push plugin family) resolved per-tenant via the external-contributions bridge — no
 * in-tree fallback. Returns null when none is installed (delivery is skipped).
 */
async function resolvePushProvider(tenantId: string): Promise<IsolatedPushProvider | null> {
  const exts = await listExternalContributions(tenantId, PUSH_PROVIDER_POINT);
  if (exts.length === 0) return null;
  const wanted = await getPushProviderKey(tenantId);
  const ext = exts.find((c) => c.key === wanted) ?? exts.find((c) => c.configured) ?? exts[0];
  return new IsolatedPushProvider(ext.invoke);
}

async function sendToSubscription(
  tenantId: string,
  sub: { id: string; endpoint: string; p256dh: string | null; auth: string | null; userId?: string },
  payload: PushPayload,
  provider: IsolatedPushProvider,
): Promise<void> {
  // notification_push.02 (fixed 2026-10-20): re-checked at send time, not only at subscribe time: a stored endpoint (or one
  // whose name now resolves to a private address) that is not a public push service is never sent to.
  if (!(await endpointResolvesPublic(sub.endpoint))) {
    await recordOutcome(tenantId, false);
    await logDelivery(tenantId, sub, payload, 'failed', 'endpoint is not a public push service');
    Logger.warn(`Push subscription ${sub.id} refused at send time: endpoint is not a public push service`);
    return;
  }
  const result = await provider.send({ endpoint: sub.endpoint, p256dh: sub.p256dh ?? '', auth: sub.auth ?? '' }, payload);
  if (result.ok) {
    await recordOutcome(tenantId, true);
    await logDelivery(tenantId, sub, payload, 'sent');
    return;
  }
  await recordOutcome(tenantId, false);
  await logDelivery(tenantId, sub, payload, 'failed', result.error);
  // 404/410 = the push subscription is gone — prune it (same as the built-in did).
  if (result.statusCode === 410 || result.statusCode === 404) {
    Logger.warn(`Push subscription ${sub.id} expired (${result.statusCode}), removing.`);
    await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo.delete({ tenantId, id: sub.id })).catch(() => {});
    if (sub.userId) await clearCacheForUser(tenantId, sub.userId);
  } else {
    Logger.error(`Push notification failed for ${sub.id}: ${result.error}`);
  }
}

/** A stored subscription as the senders see it. `provider` is absent on rows from before Expo support. */
type DeliverableSub = { id: string; endpoint: string; p256dh?: string | null; auth?: string | null; userId?: string; provider?: string | null };

/** Prune one subscription (the push service said it is gone) and drop its owner's cache. */
async function pruneSubscription(tenantId: string, sub: { id: string; userId?: string }): Promise<void> {
  await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo.delete({ tenantId, id: sub.id })).catch(() => {});
  if (sub.userId) await clearCacheForUser(tenantId, sub.userId);
}

/** Native-app subscriptions: one batched call to Expo, then the same bookkeeping as Web Push. */
async function sendToExpoSubscriptions(tenantId: string, subs: DeliverableSub[], payload: PushPayload): Promise<void> {
  const results = await sendExpo(subs.map((sub) => ({ token: sub.endpoint, payload })));
  await Promise.all(results.map(async (result, i) => {
    const sub = subs[i];
    await recordOutcome(tenantId, result.ok);
    await logDelivery(tenantId, sub, payload, result.ok ? 'sent' : 'failed', result.error);
    if (result.ok) {
      // Accepted, not yet delivered: the receipt (read later) is what says the token is dead.
      if (result.ticketId && sub.userId) {
        await trackTicket({ tenantId, subscriptionId: sub.id, userId: sub.userId, ticketId: result.ticketId });
      }
      return;
    }
    if (result.gone) {
      Logger.warn(`Expo token ${sub.id} is no longer registered, removing.`);
      await pruneSubscription(tenantId, sub);
    } else {
      Logger.error(`Expo push failed for ${sub.id}: ${result.error}`);
    }
  }));
}

/**
 * Send one payload to a set of subscriptions, each through its own backend. Browsers go
 * through the tenant's sandboxed `push:provider` plugin (skipped, as before, when none is
 * installed); native apps go to Expo directly and do not depend on that plugin.
 */
async function deliver(tenantId: string, subs: DeliverableSub[], payload: PushPayload): Promise<void> {
  if (subs.length === 0) return;
  const expo = subs.filter((s) => s.provider === 'expo');
  const web = subs.filter((s) => !s.provider || s.provider === 'webpush');

  await Promise.all([
    (async () => {
      if (web.length === 0) return;
      const provider = await resolvePushProvider(tenantId);
      if (!provider) return;
      await Promise.allSettled(web.map((sub) => sendToSubscription(tenantId, sub as Parameters<typeof sendToSubscription>[1], payload, provider)));
    })(),
    expo.length ? sendToExpoSubscriptions(tenantId, expo, payload) : Promise.resolve(),
  ]);
}

/** Audit each push attempt to the central notification_log (best-effort). */
async function logDelivery(
  tenantId: string,
  sub: { endpoint: string; userId?: string },
  payload: PushPayload,
  status: 'sent' | 'failed',
  error?: string,
): Promise<void> {
  try {
    const { default: NotificationLogService } = await import('@kuraykaraaslan-labs/notification_log/server/notification_log.service');
    await NotificationLogService.log(tenantId, 'push', sub.userId ?? sub.endpoint, status, {
      subject: payload.title, provider: 'push', error,
    });
  } catch { /* never let logging break delivery */ }
}

export async function sendToUser(
  tenantId: string,
  userId: string,
  payload: PushPayload,
  opts?: { category?: string; respectQuietHours?: boolean; idempotencyKey?: string },
): Promise<void> {
  // Optional exactly-once guard so a retried event doesn't push twice to a user.
  return RedisIdempotencyService.run(tenantId, opts?.idempotencyKey, async () => {
    if (!(await isPushEnabled(tenantId))) return;
    // Quiet hours suppress non-urgent (respectQuietHours) deliveries.
    if (opts?.respectQuietHours && await isWithinQuietHours(tenantId, userId)) return;
    const subs = (await getSubscriptionsForUser(tenantId, userId))
      .filter((sub) => wantsCategory(sub, opts?.category));
    await deliver(tenantId, subs, payload);
  });
}

export async function sendToUsers(
  tenantId: string,
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (!userIds.length) return;
  if (!(await isPushEnabled(tenantId))) return;
  const subs = await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo.find({
    where: { tenantId, userId: In(userIds) },
  }));
  await deliver(tenantId, subs, payload);
}

/**
 * Broadcast to every active member of {tenantId} with {role}.
 * Uses TenantMember (tenant-scoped roles) instead of the global User.userRole.
 */
export async function sendToRole(
  tenantId: string,
  role: string,
  payload: PushPayload,
): Promise<void> {
  if (!(await isPushEnabled(tenantId))) return;
  const members = await withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.find({
    where: { tenantId, memberRole: role, memberStatus: 'ACTIVE' },
    select: ['userId'],
  }));
  if (!members.length) return;
  const subs = await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo.find({
    where: { tenantId, userId: In(members.map((m) => m.userId)) },
  }));
  await deliver(tenantId, subs, payload);
}

export async function sendToAdmins(tenantId: string, payload: PushPayload): Promise<void> {
  await sendToRole(tenantId, 'ADMIN', payload);
}

/**
 * Broadcast to every subscriber in {tenantId}. Note: "all" is now scoped
 * to one tenant — there is no cross-tenant broadcast by design.
 */
export async function sendToAll(tenantId: string, payload: PushPayload): Promise<void> {
  if (!(await isPushEnabled(tenantId))) return;
  const subs = await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, (repo) => repo.find({ where: { tenantId } }));
  await deliver(tenantId, subs, payload);
}
