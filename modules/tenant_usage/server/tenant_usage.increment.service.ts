import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import {
  TTL_SECONDS, type TenantUsageMetric,
  currentMonth, redisKey, currentDay, dailyKey, endpointKey,
} from './tenant_usage.keys';
import { isDeclaredMetric } from './tenant_usage.metrics';
import { projectIncrement } from './tenant_usage.telemetry';
import { countOn, settleCounter, type Counted } from './tenant_usage.reseed';
import { reconcileOwedSoon, recordUnbilled } from './tenant_usage.unbilled';

/**
 * Generic increment helper. Used by all increment* methods so that the
 * Redis key format / TTL handling stays consistent. Increment failures are
 * never thrown — usage tracking never blocks the originating action (chat /
 * upload / mail / sms) — and a month count Redis could not take is not lost
 * either: D250 (docs/audits/2026-11-03-redis-outage.md §6) writes its units to
 * `tenant_usage_unbilled`, D25's ledger, which the flush job (and the next
 * count that reaches Redis) applies to the counters. Before, the units were
 * logged and dropped, so an outage silently under-billed every metered action.
 */
export async function increment(
  tenantId: string,
  metric: TenantUsageMetric | (string & {}),
  delta: number,
): Promise<number> {
  if (!tenantId || delta <= 0) return 0;
  // docs/phases/31-feature-gate/02: any DECLARED key is accepted; an unknown one is logged and dropped, never thrown.
  if (!(await isDeclaredMetric(metric))) return 0;
  const month = currentMonth();
  const key = redisKey(tenantId, metric, month);
  let counted: Counted;
  try {
    // D26: a counter a count re-created (Redis lost it, or the month's first count) takes the month's stored value back and
    // its TTL (tenant_usage.reseed.ts)
    counted = await countOn(tenantId, metric, month, key, delta);
  } catch (error) {
    // D250: the units go to the ledger (month and day), never only to the log (a delta that is no whole number is no count at all)
    if (Number.isSafeInteger(delta)) await recordUnbilled(tenantId, metric, delta);
    Logger.warn(
      `TenantUsageService._increment could not count ${metric} in Redis (recorded as unbilled): ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 0;
  }
  // this process may owe rows from an outage: Redis answers again, so they are applied (at most every 10 s, never awaited)
  reconcileOwedSoon();
  try {
    const newCount = counted.after + (counted.stored ?? 0);
    // the curve on the Core telemetry store (42-telemetry/06): the counter is the truth, this is its chart
    projectIncrement(tenantId, metric, delta);
    // Daily-granularity counter (within the month) — best-effort.
    try {
      const day = currentDay();
      await countOn(tenantId, metric, day, dailyKey(tenantId, metric, day), delta);
    } catch { /* ignore daily counter errors */ }
    // Peak/watermark for gauge-style metrics (e.g. storageBytes).
    if (metric === 'storageBytes') {
      try {
        const peakKey = `${key}:peak`;
        const peak = Number(await redis.get(peakKey)) || 0;
        if (newCount > peak) {
          // GETSET is an atomic swap: when it hands back a larger peak a concurrent increment stored meanwhile,
          // that peak is written back (and re-checked), so the watermark never ends below a counter value.
          let mine = newCount;
          for (;;) {
            const prev = Number(await redis.getset(peakKey, String(mine))) || 0;
            if (prev <= mine) break;
            mine = prev;
          }
          await redis.expire(peakKey, TTL_SECONDS);
        }
      } catch { /* ignore */ }
    }
    return newCount;
  } catch (error) {
    Logger.warn(
      `TenantUsageService._increment failed for ${metric}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 0;
  }
}

export async function incrementApiCall(tenantId: string, endpoint?: string): Promise<number> {
  // No tenant, no key: checked here because the endpoint hash is written before increment() runs its own check.
  if (!tenantId) return 0;
  // Per-endpoint breakdown (not just total) — best-effort hash counter.
  if (endpoint) {
    try {
      const hkey = endpointKey(tenantId, currentMonth());
      await redis.hincrby(hkey, endpoint, 1);
      await redis.expire(hkey, TTL_SECONDS);
    } catch { /* ignore */ }
  }
  return increment(tenantId, 'apiCalls', 1);
}

export async function incrementAiTokens(tenantId: string, tokens: number): Promise<void> {
  await increment(tenantId, 'aiTokens', tokens);
}

export async function incrementStorageBytes(tenantId: string, bytes: number): Promise<void> {
  await increment(tenantId, 'storageBytes', bytes);
}

export async function incrementEmailSends(tenantId: string, count: number = 1): Promise<void> {
  await increment(tenantId, 'emailSends', count);
}

export async function incrementSmsSends(tenantId: string, count: number = 1): Promise<void> {
  await increment(tenantId, 'smsSends', count);
}

export async function incrementWebhookCall(tenantId: string, count: number = 1): Promise<void> {
  await increment(tenantId, 'webhookCalls', count);
}

export async function decrementStorageBytes(tenantId: string, bytes: number): Promise<void> {
  if (!tenantId || bytes <= 0) return;
  const month = currentMonth();
  const key = redisKey(tenantId, 'storageBytes', month);
  try {
    // a counter this re-creates (Redis had lost it, or none this month yet) gets the stored value back and its TTL (D26)
    await countOn(tenantId, 'storageBytes', month, key, -bytes);
  } catch (error) {
    // D250: a release Redis could not take is a negative ledger row, so the freed bytes are not billed either
    await recordUnbilled(tenantId, 'storageBytes', -bytes);
    Logger.warn(
      `TenantUsageService.decrementStorageBytes failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Several increments in ONE `MULTI` round trip — for producers that flush per
 * batch rather than per event (the IoT gateway increments per flush, not per
 * message). Each entry bumps the month counter and the day counter exactly like
 * {@link increment}; undeclared keys and non-positive deltas are skipped. Returns
 * how many metrics were applied. Best-effort: failures are logged, never thrown.
 */
export async function incrementBatch(tenantId: string, deltas: Map<string, number>): Promise<number> {
  if (!tenantId) return 0;
  const month = currentMonth();
  const day = currentDay();
  // Which entries count is settled before the MULTI is opened, so nothing awaits between queueing and exec.
  const accepted: Array<[string, number]> = [];
  for (const [metric, delta] of deltas) {
    if (delta > 0 && await isDeclaredMetric(metric)) accepted.push([metric, delta]);
  }
  const tx = redis.multi();
  let applied = 0;
  for (const [metric, delta] of accepted) {
    const mKey = redisKey(tenantId, metric, month);
    const dKey = dailyKey(tenantId, metric, day);
    tx.incrby(mKey, delta).ttl(mKey).incrby(dKey, delta).ttl(dKey);
    applied++;
  }
  if (applied === 0) return 0;
  let replies: Awaited<ReturnType<typeof tx.exec>>;
  try {
    replies = await tx.exec();
    if (!replies) throw new Error('the count MULTI was aborted');
  } catch (error) {
    // D250: nothing of the MULTI was counted; every accepted entry goes to the ledger instead of being dropped
    for (const [metric, delta] of accepted) await recordUnbilled(tenantId, metric, delta);
    Logger.warn(`TenantUsageService.incrementBatch could not count in Redis (recorded as unbilled): ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
  reconcileOwedSoon();
  // D26: a counter left with no TTL was re-created by a count and is settled here (tenant_usage.reseed.ts); four replies per
  // metric (month INCRBY, TTL, day INCRBY, TTL)
  for (const [i, [metric, delta]] of accepted.entries()) {
    // D250: a month INCRBY that Redis refused inside the MULTI is not counted: its units go to the ledger
    if (replies[i * 4]?.[0]) {
      await recordUnbilled(tenantId, metric, delta);
      applied--;
      continue;
    }
    if (replies[i * 4 + 1]?.[1] === -1) await settleCounter(tenantId, metric, month, redisKey(tenantId, metric, month));
    if (replies[i * 4 + 3]?.[1] === -1) await settleCounter(tenantId, metric, day, dailyKey(tenantId, metric, day));
  }
  return applied;
}
