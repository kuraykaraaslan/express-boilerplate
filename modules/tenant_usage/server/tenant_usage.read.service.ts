import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { In } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { TenantUsage } from './entities/tenant_usage.entity';
import { TenantUsageMetricRow } from './entities/tenant_usage_metric.entity';
import { getMetricDeclaration, LEGACY_METRIC_KEYS } from './tenant_usage.metrics';
import TenantUsageMessages from './tenant_usage.messages';
import { countOn, settleCounter } from './tenant_usage.reseed';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import {
  METRICS, type TenantUsageMetric, type TenantUsageSnapshot,
  currentMonth, currentDay, redisKey, dailyKey, endpointKey,
} from './tenant_usage.keys';

/** Daily usage series for a metric (most recent `days`, oldest first). */
export async function getDailyUsage(tenantId: string, metric: TenantUsageMetric, days = 30): Promise<Array<{ day: string; value: number }>> {
  const out: Array<{ day: string; value: number }> = [];
  const keys: string[] = [];
  const dayLabels: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const day = d.toISOString().slice(0, 10);
    dayLabels.push(day);
    keys.push(dailyKey(tenantId, metric, day));
  }
  let vals: (string | null)[] = [];
  try { vals = await redis.mget(...keys); } catch { vals = keys.map(() => null); }
  dayLabels.forEach((day, i) => out.push({ day, value: vals[i] ? parseInt(vals[i] as string, 10) : 0 }));
  return out;
}

/** Per-endpoint API-call breakdown for a month. */
export async function getEndpointBreakdown(tenantId: string, month?: string): Promise<Record<string, number>> {
  const hkey = endpointKey(tenantId, month ?? currentMonth());
  try {
    const h = await redis.hgetall(hkey);
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(h)) out[k] = parseInt(v, 10) || 0;
    return out;
  } catch { return {}; }
}

/** Peak observed value for a gauge metric this month (e.g. storageBytes). */
export async function getPeak(tenantId: string, metric: TenantUsageMetric, month?: string): Promise<number> {
  const key = `${redisKey(tenantId, metric, month ?? currentMonth())}:peak`;
  try { return Number(await redis.get(key)) || 0; } catch { return 0; }
}

/**
 * The six legacy counters of `month` (default: the current one). Lead decision D26: a counter Redis does not have, or one a
 * count re-created that has not taken its stored value back yet (no TTL, tenant_usage.reseed.ts), is short of the month's
 * stored value, so the table's value counts for it; in the current month such a counter is created and settled here, so the
 * next read finds it. Redis down: the table alone.
 */
export async function getUsage(
  tenantId: string,
  month?: string,
): Promise<TenantUsageSnapshot> {
  const targetMonth = month ?? currentMonth();

  let counters: Array<{ value: number; plusStored: boolean }> | null = null;
  try { counters = await usageCounters(tenantId, targetMonth); } catch { /* fall through to DB */ }
  if (counters && !counters.some((c) => c.plusStored)) return snapshotOfValues(counters.map((c) => c.value));

  // The open table (42-telemetry/06 step 5: the six legacy metrics are rows of `tenant_usage_metrics`, like every other)
  let table: TenantUsageSnapshot;
  try {
    const rows = await withTenantRepositoryFor(tenantId, TenantUsageMetricRow, (repo) =>
      repo.find({ where: { tenantId, period: targetMonth, metric: In([...METRICS]) } }));
    table = snapshotOf(rows.filter((r) => r.period === targetMonth));
  } catch (error) {
    if (error instanceof AppError) throw error;
    Logger.error(`[TenantUsage] getUsage DB fallback failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new AppError(TenantUsageMessages.FETCH_FAILED, 500, ErrorCode.INTERNAL_ERROR);
  }
  if (!counters) return table;
  const read = counters;
  return snapshotOfValues(METRICS.map((m, i) => read[i]!.value + (read[i]!.plusStored ? table[m] : 0)));
}

/**
 * Each legacy counter of `month` (one MULTI: the values and their TTLs) as its value, and whether the month's stored value
 * still has to be added to it (D26): a missing or unsettled counter of the current month is created and settled here
 * (`plusStored` only when its stored value could not be read); of another month it is left as it is. Throws on a Redis error.
 */
async function usageCounters(tenantId: string, month: string): Promise<Array<{ value: number; plusStored: boolean }>> {
  const keys = METRICS.map((m) => redisKey(tenantId, m, month));
  const tx = redis.multi().mget(...keys);
  for (const key of keys) tx.ttl(key);
  const replies = await tx.exec();
  const [error, values] = replies?.[0] ?? [new Error('the usage read MULTI was aborted'), null];
  if (error) throw error;
  return Promise.all(METRICS.map(async (metric, i) => {
    const raw = (values as (string | null)[])[i] ?? null;
    const value = raw !== null ? parseInt(raw, 10) || 0 : 0;
    if (raw !== null && replies?.[i + 1]?.[1] !== -1) return { value, plusStored: false };
    if (month !== currentMonth()) return { value, plusStored: true };
    try {
      // INCRBY 0 creates a missing counter, which the count then settles (tenant_usage.reseed.ts)
      const c = raw === null
        ? await countOn(tenantId, metric, month, keys[i]!, 0, true)
        : { after: value, stored: await settleCounter(tenantId, metric, month, keys[i]!, true) };
      return c.stored === null ? { value: c.after, plusStored: true } : { value: c.after + c.stored, plusStored: false };
    } catch {
      return { value, plusStored: true };
    }
  }));
}

/** A snapshot from the six legacy counters' values, in METRICS order. */
function snapshotOfValues(values: number[]): TenantUsageSnapshot {
  const out = {} as TenantUsageSnapshot;
  METRICS.forEach((m, i) => { out[m] = values[i] ?? 0; });
  return out;
}

/** The six legacy counters of one period from the open table's rows (a missing metric is 0). */
function snapshotOf(rows: ReadonlyArray<Pick<TenantUsageMetricRow, 'metric' | 'value'>>): TenantUsageSnapshot {
  const out: TenantUsageSnapshot = { apiCalls: 0, aiTokens: 0, storageBytes: 0, emailSends: 0, smsSends: 0, webhookCalls: 0 };
  for (const r of rows) if ((METRICS as string[]).includes(r.metric)) out[r.metric as TenantUsageMetric] = Number(r.value) || 0;
  return out;
}

/**
 * Multi-month usage history (most recent first) of the six legacy counters, read from the open table's month rows
 * (42-telemetry/06 step 5). `months` bounds the window (default 12).
 */
export async function getHistory(tenantId: string, months = 12): Promise<Array<TenantUsageSnapshot & { month: string }>> {
  const rows = await withTenantRepositoryFor(tenantId, TenantUsageMetricRow, (repo) => repo.find({
    where: { tenantId, metric: In([...METRICS]) },
    order: { period: 'DESC' },
  }));
  const byMonth = new Map<string, Array<Pick<TenantUsageMetricRow, 'metric' | 'value'>>>();
  for (const r of rows) if (/^\d{4}-\d{2}$/.test(r.period)) (byMonth.get(r.period) ?? byMonth.set(r.period, []).get(r.period)!).push(r);
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .slice(0, Math.min(Math.max(months, 1), 120))
    .map(([month, list]) => ({ month, ...snapshotOf(list) }));
}

/** The period label a metric is currently counted in: `YYYY-MM` or `YYYY-MM-DD` (UTC). */
export async function currentPeriodFor(metric: string): Promise<string> {
  return (await getMetricDeclaration(metric))?.period === 'day' ? currentDay() : currentMonth();
}

/**
 * One declared metric for one period (default: the current one) — the single read
 * API behind `feature_gate` quotas and the usage screen.
 *
 * Order: the Redis hot counter (always the freshest, and the only source for the
 * period in progress), then the open `tenant_usage_metrics` table (the persisted
 * answer for a closed period), then — for the six legacy metrics only — the old
 * `tenant_usage` column, so a tenant whose flush predates the new table still reads
 * its number. Unknown metric keys read 0. A counter a count re-created that is not
 * settled yet (D26) reads the stored value plus the counter.
 */
export async function getMetricUsage(tenantId: string, metric: string, period?: string): Promise<number> {
  const decl = await getMetricDeclaration(metric);
  if (!decl) return 0;
  const target = period ?? (decl.period === 'day' ? currentDay() : currentMonth());
  const key = decl.period === 'day' ? dailyKey(tenantId, metric, target) : redisKey(tenantId, metric, target);
  // D26: a counter a count re-created (no TTL) that has not taken its stored value back yet is short of it (tenant_usage.reseed.ts)
  let counter = 0;
  try {
    const replies = await redis.multi().get(key).ttl(key).exec();
    const [error, raw] = replies?.[0] ?? [new Error('the usage read MULTI was aborted'), null];
    if (error) throw error;
    if (raw !== null && raw !== undefined) {
      counter = parseInt(raw as string, 10) || 0;
      if (replies?.[1]?.[1] !== -1) return counter;
    }
  } catch { /* fall through to the table */ }

  const row = await withTenantRepositoryFor(tenantId, TenantUsageMetricRow, (repo) =>
    repo.findOne({ where: { tenantId, period: target, metric } }));
  if (row) return Number(row.value) + counter;

  if (decl.period === 'month' && LEGACY_METRIC_KEYS.includes(metric)) {
    const legacy = await withTenantRepositoryFor(tenantId, TenantUsage, (repo) =>
      repo.findOne({ where: { tenantId, month: target } }));
    if (legacy) return Number((legacy as unknown as Record<string, number | string | null>)[metric] ?? 0) + counter;
  }
  return counter;
}
