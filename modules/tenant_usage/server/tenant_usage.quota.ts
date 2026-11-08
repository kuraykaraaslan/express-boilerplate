import redis from '@kuraykaraaslan-labs/redis';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import {
  assertPeriodQuota, checkPeriodQuota, PERIOD_QUOTA_EXCEEDED, type PeriodQuotaStatus,
} from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.period-quota';
import type { HeadroomResult, GateErrorPolicy } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.headroom';
import { getMetricDeclaration } from './tenant_usage.metrics';
import { getMetricUsage } from './tenant_usage.read.service';
import { increment } from './tenant_usage.increment.service';
import { currentDay, currentMonth, dailyKey, redisKey } from './tenant_usage.keys';
import { pendingUnbilled, reconcileOwedSoon, recordUnbilled } from './tenant_usage.unbilled';
import { countOn, type Counted } from './tenant_usage.reseed';
import TenantUsageMessages from './tenant_usage.messages';

/**
 * `metric`-keyed convenience over `feature_gate`'s period quotas: resolves the
 * metric's declared `quotaKey`, reads the current period's value through
 * {@link getMetricUsage} (Redis hot counter, then the table) and delegates.
 *
 * A metric with no declared `quotaKey` has no plan quota: both functions treat it
 * as unlimited rather than guessing a key.
 *
 * assertMetricQuota / checkMetricQuota are checks, not reservations: a caller that
 * checks and then increments races a concurrent caller between the two (both read
 * 9 of 10 and both pass). {@link reserveMetricQuota} is the race-free path for a
 * caller that consumes units; the two checks stay for read-only and soft callers.
 */

export async function assertMetricQuota(
  tenantId: string,
  metric: string,
  options: { adding?: number; onGateError: GateErrorPolicy; gracePercent?: number; message?: string },
): Promise<HeadroomResult> {
  const quotaKey = (await getMetricDeclaration(metric))?.quotaKey;
  if (!quotaKey) return { limit: Infinity, current: null, remaining: Infinity };
  return assertPeriodQuota(tenantId, quotaKey, { ...options, used: () => getMetricUsage(tenantId, metric) });
}

export async function checkMetricQuota(
  tenantId: string,
  metric: string,
  options: { onGateError: GateErrorPolicy; gracePercent?: number },
): Promise<PeriodQuotaStatus> {
  const used = await getMetricUsage(tenantId, metric);
  const quotaKey = (await getMetricDeclaration(metric))?.quotaKey;
  if (!quotaKey) return { limit: Infinity, used, remaining: Infinity, inGrace: false };
  return checkPeriodQuota(tenantId, quotaKey, { ...options, used });
}

/**
 * Check and count in one step, race-free: INCRBY the counter the quota reads first,
 * then compare the new value with the plan limit (the same source and gate-error
 * policy as {@link checkMetricQuota}). Over the limit, the units are taken back
 * (DECRBY) and the call is refused with the same 403 a refused assertMetricQuota
 * throws. It replaces the caller's own increment: on success the units are counted.
 *
 * A Redis error on the reservation keeps admitting (lead decision D25: a lost device
 * message is worse than a bill a few minutes late): the plan is checked against the
 * table's value plus the units already recorded unbilled, and the units are written to
 * `tenant_usage_unbilled` (tenant_usage.unbilled.ts), to be added to the counters once
 * Redis answers again. When the plan or the table cannot be read either (Postgres down
 * too) the reservation throws, as any check of a closed quota does, and the caller
 * refuses. A metric with no `quotaKey` is just counted. The storageBytes peak watermark
 * is not kept here (storage is not reserved).
 *
 * A counter Redis lost (a restart with empty data) is re-created by the INCRBY with no TTL (lead decision D26,
 * tenant_usage.reseed.ts): the INCRBY and the TTL read are one snapshot, so while the counter is not settled the plan decides on
 * the period's stored value plus the reply, whichever reservation settles it and however many run at once. When the stored
 * value cannot be read the plan cannot be told the usage: `onGateError: 'closed'` refuses (the units are taken back), `'open'`
 * admits, as for a plan that cannot be read.
 */
export async function reserveMetricQuota(
  tenantId: string,
  metric: string,
  options: { adding?: number; onGateError: GateErrorPolicy; gracePercent?: number; message?: string },
): Promise<HeadroomResult> {
  const adding = options.adding ?? 1;
  const decl = await getMetricDeclaration(metric);
  const quotaKey = decl?.quotaKey;
  if (!decl || !quotaKey || !tenantId || adding <= 0) {
    await increment(tenantId, metric, adding);
    return { limit: Infinity, current: null, remaining: Infinity };
  }
  // The counter getMetricUsage reads for this metric's period, and the other one, counted only once the units are accepted.
  const month = currentMonth();
  const day = currentDay();
  const monthKey = redisKey(tenantId, metric, month);
  const dayKey = dailyKey(tenantId, metric, day);
  const [quotaCounter, otherCounter] = decl.period === 'day' ? [dayKey, monthKey] : [monthKey, dayKey];
  const [quotaPeriod, otherPeriod] = decl.period === 'day' ? [day, month] : [month, day];

  let counted: Counted;
  try {
    counted = await countOn(tenantId, metric, quotaPeriod, quotaCounter, adding, true);
  } catch {
    // D25: the plan still decides (the last flushed value plus what is already owed); what it admits is owed, not lost. A plan
    // or table read that fails throws from here: with `onGateError: 'closed'` an unreadable plan refuses, outage or not.
    const result = await assertPeriodQuota(tenantId, quotaKey, {
      ...options, used: async () => (await getMetricUsage(tenantId, metric)) + (await pendingUnbilled(tenantId, metric, quotaPeriod)),
    });
    await recordUnbilled(tenantId, metric, adding);
    return result;
  }
  reconcileOwedSoon();
  if (counted.stored === null) {
    // D26: a counter not settled yet whose stored value cannot be read: the usage is unknown, so the gate-error policy decides
    if (options.onGateError === 'open') {
      await countOther(tenantId, metric, otherPeriod, otherCounter, adding);
      return { limit: Infinity, current: null, remaining: Infinity };
    }
    await redis.decrby(quotaCounter, adding).catch(() => undefined);
    throw new AppError(TenantUsageMessages.FETCH_FAILED, 503, ErrorCode.INTERNAL_ERROR);
  }
  // D26: an unsettled counter's reply lacks what the period stored before Redis lost it; the sum is its true value at this count
  const after = counted.after + counted.stored;
  const current = after - adding;
  let status: PeriodQuotaStatus;
  try {
    status = await checkPeriodQuota(tenantId, quotaKey, { used: current, onGateError: options.onGateError, gracePercent: options.gracePercent });
  } catch (error) {
    await redis.decrby(quotaCounter, adding).catch(() => undefined);
    throw error;
  }
  if (after > status.limit) {
    await redis.decrby(quotaCounter, adding).catch(() => undefined);
    throw new AppError(options.message ?? PERIOD_QUOTA_EXCEEDED, 403, ErrorCode.FORBIDDEN, {
      details: { key: quotaKey, limit: status.limit, current, adding },
    });
  }
  await countOther(tenantId, metric, otherPeriod, otherCounter, adding);
  return status.limit === Infinity
    ? { limit: Infinity, current: null, remaining: Infinity }
    : { limit: status.limit, current, remaining: Math.max(0, status.limit - current) };
}

/** The counter the quota does not read, counted once the units are accepted: best-effort, like increment(). */
async function countOther(tenantId: string, metric: string, period: string, key: string, adding: number): Promise<void> {
  try { await countOn(tenantId, metric, period, key, adding); } catch { /* best-effort */ }
}

/**
 * Give back units a {@link reserveMetricQuota} took when the action they paid for did not happen after all (a producer
 * refused the message). Never throws. A month counter Redis cannot lower is owed back instead (D25: a negative unbilled
 * row, reconciled with the rest), so a message admitted and then refused during an outage is not billed; the day counter
 * stays best-effort. A counter the DECRBY re-creates (Redis lost it) gets its stored value back and its TTL (D26).
 */
export async function releaseMetricQuota(tenantId: string, metric: string, units: number = 1): Promise<void> {
  if (!tenantId || units <= 0 || !(await getMetricDeclaration(metric))) return;
  const month = currentMonth();
  const day = currentDay();
  const monthKey = redisKey(tenantId, metric, month);
  try {
    await countOn(tenantId, metric, month, monthKey, -units);
  } catch {
    await recordUnbilled(tenantId, metric, -units);
    return;
  }
  try { await countOn(tenantId, metric, day, dailyKey(tenantId, metric, day), -units); } catch { /* best-effort */ }
}
