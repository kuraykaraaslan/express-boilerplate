import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import ObservabilityService from '@kuraykaraaslan-labs/observability/server/observability.service';
import { TenantUsageMetricRow } from './entities/tenant_usage_metric.entity';
import { getMetricDeclaration } from './tenant_usage.metrics';
import { SETTLE_SCRIPT, TTL_SECONDS } from './tenant_usage.keys';

/**
 * Lead decision D26 (docs/audits/2026-10-28-lead-decisions.md): a usage counter Redis lost (a restart with empty data, an
 * eviction) takes the stored value back before anything is decided on it or written from it. Without it the next count
 * re-created the counter from 0, the plan was checked against that, and the hourly flush overwrote the month's
 * `tenant_usage_metrics` row with the smaller number.
 *
 * A counter with a TTL is SETTLED: its value includes what its period stored before it. Every count runs its INCRBY / DECRBY
 * and a TTL read in one MULTI ({@link countOn}); a TTL of -1 means a count re-created the counter (Redis lost it, or it is the
 * period's first count) and nobody has settled it yet. {@link settleCounter} reads the period's stored value and runs
 * SETTLE_SCRIPT (tenant_usage.keys.ts): while the counter still has no TTL, the stored value is added and the TTL set, in one
 * atomic step. So any number of callers, in any process, may settle the same counter: the script applies once, and each
 * caller knows the counter's true value at its own count (its reply plus the stored value, because the count and the
 * missing TTL were one snapshot). Until a counter is settled the reservation decides on that sum (tenant_usage.quota.ts), the
 * reads add the stored value (tenant_usage.read.service.ts), and the flush skips it (tenant_usage.flush.service.ts).
 *
 * Only the counter a metric is billed from has a stored value to take back (the month's, or the day's for a day metric: the
 * counters flushToDb writes); any other counter a count re-created just gets its TTL. A settle that fails (Postgres or Redis
 * error) leaves the counter without a TTL: the next count of it, in any process, or the next flush settles it. A count that
 * does not decide on the result retries a failed counter at most every {@link RESEED_RETRY_MS} per process; a reservation
 * and the flush always try. What was counted after the last flush and before Redis lost the counter is gone (at most one flush interval).
 * Metric `tenant_usage_counter_reseeds_total{metric,outcome}` (`reseeded`, `failed`), alerts `UsageCounterReseeded` and
 * `UsageCounterReseedFailed` (observability alert-rules.ts).
 */

/** A count that does not decide on its result tries a counter that failed to settle in this process again at most this often. */
export const RESEED_RETRY_MS = 10_000;

export type ReseedOutcome = 'reseeded' | 'failed';

let reseedCounter: ReturnType<typeof ObservabilityService.counter> | null = null;
const reseedMetric = () => (reseedCounter ??= ObservabilityService.counter({
  name: 'tenant_usage_counter_reseeds_total',
  help: 'Usage counters Redis had lost, re-seeded from the stored value or not, by metric',
  labelNames: ['metric', 'outcome'],
}));

/** Counters that failed to settle in this process: `key` -> when a count that does not decide may try again. */
const failing = new Map<string, number>();

/** Whether `period` (`YYYY-MM` or `YYYY-MM-DD`) is the one `metric` is billed from: its month, or its day for a day metric. */
export async function isBilledCounter(metric: string, period: string): Promise<boolean> {
  const decl = await getMetricDeclaration(metric);
  return !!decl && (decl.period === 'day') === (period.length > 7);
}

export interface Counted {
  /** The reply of the INCRBY / DECRBY. */
  after: number;
  /** The counter had no TTL at this count: a count re-created it and it was not settled yet. */
  unsettled: boolean;
  /**
   * For an unsettled counter, the stored value its life starts from (0 for one that is not billed or has nothing stored), so
   * its true value at this count is `after + stored`; null when it could not be read. 0 for a settled counter.
   */
  stored: number | null;
}

/**
 * Counts `delta` (negative: a DECRBY) on `key`, the counter of `metric` for `period`, and reads its TTL in the same MULTI, then
 * settles the counter when it had none. `force`: the caller decides on the result (a reservation), so the stored value is
 * read even when this counter failed to settle a moment ago. Throws when Redis refuses the count.
 */
export async function countOn(
  tenantId: string, metric: string, period: string, key: string, delta: number, force = false,
): Promise<Counted> {
  // what Redis answers an INCRBY of a non-integer, without the round trip
  if (!Number.isSafeInteger(delta)) throw new Error('ERR value is not an integer or out of range');
  const replies = await redis.multi().incrby(key, delta).ttl(key).exec();
  const [error, reply] = replies?.[0] ?? [new Error('the count MULTI was aborted'), null];
  if (error) throw error;
  const after = Number(reply);
  if (replies?.[1]?.[1] !== -1) return { after, unsettled: false, stored: 0 };
  return { after, unsettled: true, stored: await settleCounter(tenantId, metric, period, key, force) };
}

/**
 * Settles `key` (the counter of `metric` for `period`) if it still has no TTL and returns the stored value its life starts
 * from (0 when it is not a billed counter or nothing is stored), or null when that could not be read or applied. `force` (a
 * reservation, the flush): try even when this counter failed to settle in this process less than RESEED_RETRY_MS ago. Never
 * throws.
 */
export async function settleCounter(
  tenantId: string, metric: string, period: string, key: string, force = false,
): Promise<number | null> {
  // concurrent callers each read the row (a unique-key lookup, once per counter's life): the script still applies once
  if (!force && (failing.get(key) ?? 0) > Date.now()) return null;
  return settle(tenantId, metric, period, key);
}

async function settle(tenantId: string, metric: string, period: string, key: string): Promise<number | null> {
  let billed: boolean;
  try {
    billed = !!tenantId && await isBilledCounter(metric, period);
  } catch {
    return null;
  }
  if (!billed) {
    // nothing stored to take back: the counter only needs its TTL (a later count sets it when this fails)
    await redis.expire(key, TTL_SECONDS).catch(() => undefined);
    return 0;
  }
  try {
    const row = await withTenantRepositoryFor(tenantId, TenantUsageMetricRow, (repo) => repo.findOne({ where: { tenantId, period, metric } }));
    const stored = Math.max(0, Number(row?.value ?? 0) || 0);
    // applies once whoever runs it, and only while the counter has no TTL: a reply lost after Redis ran it is safe to repeat
    const applied = Number(await redis.eval(SETTLE_SCRIPT, 1, key, String(stored), String(TTL_SECONDS))) === 1;
    if (applied && stored > 0) {
      reseedMetric().inc({ metric, outcome: 'reseeded' });
      Logger.warn(`[TenantUsage] the ${metric} counter of ${tenantId} for ${period} was lost by Redis; re-seeded with the stored ${stored}`);
    }
    failing.delete(key);
    return stored;
  } catch (err) {
    // the counter keeps no TTL, so the next count of it (any process) or the next flush settles it; counted and logged once
    const first = !failing.has(key);
    failing.set(key, Date.now() + RESEED_RETRY_MS);
    if (first) {
      reseedMetric().inc({ metric, outcome: 'failed' });
      Logger.error(`[TenantUsage] the ${metric} counter of ${tenantId} for ${period} could not be re-seeded from the stored value: ${err instanceof Error ? err.message : String(err)}`);
    }
    return null;
  }
}

/** Test seam. */
export function _resetReseedForTests(): void {
  failing.clear();
}
