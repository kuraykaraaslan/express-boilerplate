import { env } from '@kuraykaraaslan-labs/env';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { PushSubscription as PushSubscriptionEntity } from './entities/push_subscription.entity';
import { clearCacheForUser, tenantMonth } from './notification_push.config';

/**
 * Expo push receipts.
 *
 * A TICKET only says Expo accepted the message. Whether APNs/FCM then delivered it — and in
 * particular that the device's token is dead (`DeviceNotRegistered`, e.g. the app was
 * uninstalled) — arrives later, in a RECEIPT that Expo keeps for ~24 hours. Without reading
 * receipts, a dead token is only ever found by luck, and the row sends into the void forever.
 *
 * `trackTicket` records each accepted ticket; `settleReceipts` (run on a schedule) asks Expo
 * for the ones old enough to have a receipt and prunes the tokens it reports dead.
 */

const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Pending tickets, scored by the time they were sent. Member: `tenantId|subscriptionId|userId|ticketId`. */
export const PENDING_KEY = 'push:expo:pending-receipts';
/** Expo recommends waiting ~15 minutes before asking. */
export const MIN_AGE_MS = 15 * 60 * 1000;
/** Receipts are kept 24 h; past that there is nothing left to ask. */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Expo accepts at most 1000 ids per request. */
export const RECEIPT_BATCH = 1000;
const REQUEST_TIMEOUT_MS = 15_000;

type Pending = { tenantId: string; subscriptionId: string; userId: string; ticketId: string };

const encode = (p: Pending): string => [p.tenantId, p.subscriptionId, p.userId, p.ticketId].join('|');
function decode(member: string): Pending | null {
  const [tenantId, subscriptionId, userId, ticketId] = member.split('|');
  return tenantId && subscriptionId && userId && ticketId ? { tenantId, subscriptionId, userId, ticketId } : null;
}

/** Remember an accepted ticket so its receipt can be read later. Best-effort: never fails a send. */
export async function trackTicket(p: Pending, now = Date.now()): Promise<void> {
  try {
    await redis.zadd(PENDING_KEY, now, encode(p));
  } catch (error) {
    Logger.warn(`[push:expo] could not track ticket ${p.ticketId}: ${error}`);
  }
}

/**
 * Count a settled receipt in the tenant's monthly metrics hash (`delivered` / `undelivered`), beside the
 * send-time `sent` / `failed` counters that only say Expo accepted a ticket. Best-effort.
 */
async function recordReceipt(tenantId: string, delivered: boolean): Promise<void> {
  try {
    const key = `push:metrics:${tenantId}:${tenantMonth()}`;
    await redis.hincrby(key, delivered ? 'delivered' : 'undelivered', 1);
    await redis.expire(key, 40 * 24 * 60 * 60);
  } catch { /* metrics never fail a sweep */ }
}

interface ExpoReceipt { status: 'ok' | 'error'; message?: string; details?: { error?: string } }

async function fetchReceipts(ids: string[]): Promise<Record<string, ExpoReceipt>> {
  const res = await fetch(RECEIPTS_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
    },
    body: JSON.stringify({ ids }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Expo receipts endpoint answered ${res.status}`);
  return ((await res.json()) as { data?: Record<string, ExpoReceipt> }).data ?? {};
}

export interface ReceiptSweepResult {
  checked: number;
  delivered: number;
  pruned: number;
  failed: number;
  /** Not in Expo's answer and past 24 h: dropped without a verdict. */
  expired: number;
  /** Not in Expo's answer yet and still young: left for the next sweep. */
  waiting: number;
  /** Native tokens dropped because the session they registered under no longer exists. */
  orphaned: number;
}

/**
 * Drop this tenant's native tokens whose `userSessionId` no longer exists. Sessions that merely
 * expire are never announced to `user_session:session_revoked`, so their tokens would linger
 * until a receipt reports them dead. One `NOT EXISTS` over the session table. Best-effort.
 */
async function pruneOrphanedTokens(tenantId: string): Promise<number> {
  try {
    const affected = await withTenantRepositoryFor(tenantId, PushSubscriptionEntity, async (repo) => {
      const res = await repo.createQueryBuilder().delete().from(PushSubscriptionEntity)
        .where('"tenantId" = :tenantId', { tenantId })
        .andWhere('"userSessionId" IS NOT NULL')
        .andWhere('NOT EXISTS (SELECT 1 FROM user_sessions s WHERE s."userSessionId" = push_subscriptions."userSessionId")')
        .execute();
      return res.affected ?? 0;
    });
    return affected;
  } catch (error) {
    Logger.warn(`[push:expo] orphaned-token prune failed for tenant ${tenantId}: ${error}`);
    return 0;
  }
}

/**
 * Settle the receipts that are due. A batch that cannot be fetched (Expo down) is left in
 * place for the next sweep, never dropped; a ticket Expo has no receipt for is retried until
 * it is a day old.
 */
export async function settleReceipts(now = Date.now()): Promise<ReceiptSweepResult> {
  const out: ReceiptSweepResult = { checked: 0, delivered: 0, pruned: 0, failed: 0, expired: 0, waiting: 0, orphaned: 0 };

  // Flat [member, score, member, score, …]; the score is when the message was sent.
  const flat = await redis.zrangebyscore(PENDING_KEY, 0, now - MIN_AGE_MS, 'WITHSCORES', 'LIMIT', 0, RECEIPT_BATCH);
  const pending: Array<Pending & { member: string; sentAt: number }> = [];
  const malformed: string[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    const p = decode(flat[i]);
    if (p) pending.push({ member: flat[i], sentAt: Number(flat[i + 1]), ...p });
    else malformed.push(flat[i]);
  }
  // Malformed members can never be settled: drop them rather than re-reading them forever.
  if (malformed.length) await redis.zrem(PENDING_KEY, ...malformed);
  if (pending.length === 0) return out;

  let receipts: Record<string, ExpoReceipt>;
  try {
    receipts = await fetchReceipts(pending.map((p) => p.ticketId));
  } catch (error) {
    Logger.error(`[push:expo] receipts fetch failed, will retry: ${error}`);
    return out;
  }

  const settled: string[] = [];
  for (const p of pending) {
    out.checked += 1;
    const receipt = receipts[p.ticketId];
    if (!receipt) {
      if (now - p.sentAt > MAX_AGE_MS) { settled.push(p.member); out.expired += 1; }
      else out.waiting += 1;
      continue;
    }
    // Claim the member atomically (ZREM answers 0 when a concurrent sweep already took it) so an
    // overlapping cron/worker run never double-counts a receipt in the metrics or prunes twice.
    if ((await redis.zrem(PENDING_KEY, p.member)) === 0) continue;
    if (receipt.status === 'ok') { out.delivered += 1; await recordReceipt(p.tenantId, true); continue; }
    await recordReceipt(p.tenantId, false);

    if (receipt.details?.error === 'DeviceNotRegistered') {
      await withTenantRepositoryFor(p.tenantId, PushSubscriptionEntity, (repo) =>
        repo.delete({ tenantId: p.tenantId, id: p.subscriptionId })).catch(() => {});
      await clearCacheForUser(p.tenantId, p.userId);
      out.pruned += 1;
      Logger.warn(`[push:expo] token ${p.subscriptionId} no longer registered (receipt), removed.`);
    } else {
      out.failed += 1;
      Logger.error(`[push:expo] delivery failed for ${p.subscriptionId}: ${receipt.message ?? receipt.details?.error}`);
    }
  }

  if (settled.length) await redis.zrem(PENDING_KEY, ...settled);

  // Once per sweep per tenant seen: tokens of sessions that expired without being revoked.
  for (const tenantId of new Set(pending.map((p) => p.tenantId))) {
    const n = await pruneOrphanedTokens(tenantId);
    if (n) {
      out.orphaned += n;
      const userIds = new Set(pending.filter((p) => p.tenantId === tenantId).map((p) => p.userId));
      for (const uid of userIds) await clearCacheForUser(tenantId, uid);
    }
  }
  return out;
}
