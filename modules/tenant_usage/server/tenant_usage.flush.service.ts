import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { In } from 'typeorm';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import { TenantUsage } from './entities/tenant_usage.entity';
import { TenantUsageMetricRow } from './entities/tenant_usage_metric.entity';
import { GAUGE_METRICS, redisKey, dailyKey, currentMonth } from './tenant_usage.keys';
import { settleCounter } from './tenant_usage.reseed';
import { getDeclaredMetrics } from './tenant_usage.metrics';

/** UTC `YYYY-MM-DD` for today and yesterday: the days a flush still owns. */
function recentDays(): string[] {
  const out: string[] = [];
  for (let i = 0; i < 2; i++) out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

/** A Postgres unique violation, through TypeORM's QueryFailedError or a raw driver error. */
function isUniqueViolation(error: unknown): boolean {
  const e = error as { code?: string; driverError?: { code?: string } };
  return e?.code === '23505' || e?.driverError?.code === '23505';
}

type FlushRow = { tenantId: string; period: string; metric: string; value: string };

/**
 * Lead decision D26: the rows are locked (FOR UPDATE); a counting metric's value only replaces a lower stored one, a gauge's
 * (GAUGE_METRICS: storageBytes) replaces any different one, both in one upsert over rows this transaction holds; a missing row
 * is inserted when its value is above 0. Two flushes that both insert the same new row: the unique key refuses the second,
 * which runs again over the row now there ({@link flushToDb}).
 */
async function storeFlushed(tenantId: string, rows: FlushRow[]): Promise<void> {
  await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(TenantUsageMetricRow);
    const stored = await repo.find({
      where: { tenantId, period: In([...new Set(rows.map((r) => r.period))]), metric: In([...new Set(rows.map((r) => r.metric))]) },
      lock: { mode: 'pessimistic_write' },
    });
    const byKey = new Map(stored.map((s) => [`${s.period}|${s.metric}`, Number(s.value)]));
    const update = rows.filter((r) => {
      const was = byKey.get(`${r.period}|${r.metric}`);
      return was !== undefined && (GAUGE_METRICS.has(r.metric) ? Number(r.value) !== was : Number(r.value) > was);
    });
    const add = rows.filter((r) => !byKey.has(`${r.period}|${r.metric}`) && Number(r.value) > 0);
    if (update.length) await repo.upsert(update, { conflictPaths: ['tenantId', 'period', 'metric'], skipUpdateIfNoValuesChanged: true });
    if (add.length) await repo.insert(add);
  });
}

/**
 * One MULTI reads every declared month metric's counter for `month` and the recent days of the declared day metrics, with
 * their TTLs, then the open `tenant_usage_metrics` table is brought up to them (docs/phases/42-telemetry/06 step 5: the wide
 * `tenant_usage` row is no longer written; migration 002 copied its history across and the table goes in the next release).
 *
 * Lead decision D26 (docs/audits/2026-10-28-lead-decisions.md, tenant_usage.reseed.ts): only a SETTLED counter is written, one
 * whose value includes what the period stored before it. A counter with no TTL was re-created by a count (Redis lost it) and
 * has not taken its stored value back yet: writing it would erase the usage the table recorded, so it is settled here and
 * written once it is. A counting metric's stored value is never lowered (a settled counter below it can only be one restored
 * from an older Redis snapshot, or one a reservation gave units back to after a flush); a gauge's (storageBytes) is its net
 * value, so it follows the counter down when files are deleted.
 */
export async function flushToDb(tenantId: string, month: string): Promise<void> {
  const extras: Counter[] = [];
  for (const d of (await getDeclaredMetrics()).values()) {
    if (d.period === 'month') {
      extras.push({ metric: d.key, period: month, key: redisKey(tenantId, d.key, month) });
    } else if (month === currentMonth()) {
      for (const day of recentDays()) extras.push({ metric: d.key, period: day, key: dailyKey(tenantId, d.key, day) });
    }
  }
  if (extras.length === 0) return;
  let read: { rows: FlushRow[]; unsettled: Counter[] };
  try { read = await readCounters(tenantId, extras); }
  catch (err) {
    Logger.warn(`[TenantUsage] flushToDb Redis read failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    return;
  }
  const rows = read.rows;
  if (read.unsettled.length) {
    const settled: Counter[] = [];
    for (const c of read.unsettled) if ((await settleCounter(tenantId, c.metric, c.period, c.key, true)) !== null) settled.push(c);
    if (settled.length) rows.push(...(await readCounters(tenantId, settled).catch(() => ({ rows: [] }))).rows);
  }

  // The open store: every declared metric (the six legacy ones included) as (tenant, period, metric) -> value, written on the unique key
  // under row locks, so two overlapping flushes of the same tenant cannot lose one (docs/phases/10-db Faz 3) nor lower one (D26).
  if (rows.length === 0) return;
  try {
    await storeFlushed(tenantId, rows);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    await storeFlushed(tenantId, rows);
  }
}

type Counter = { metric: string; period: string; key: string };

/** The settled counters among `counters` as rows (a missing one is left out, a negative one is 0), and the unsettled ones. */
async function readCounters(tenantId: string, counters: Counter[]): Promise<{ rows: FlushRow[]; unsettled: Counter[] }> {
  const tx = redis.multi().mget(...counters.map((c) => c.key));
  for (const c of counters) tx.ttl(c.key);
  const replies = await tx.exec();
  const [error, values] = replies?.[0] ?? [new Error('the flush read MULTI was aborted'), null];
  if (error) throw error;
  const rows: FlushRow[] = [];
  const unsettled: Counter[] = [];
  counters.forEach((c, i) => {
    const raw = (values as (string | null)[])[i];
    if (raw == null) return;
    const value = Math.max(0, parseInt(raw, 10) || 0);
    if (replies?.[i + 1]?.[1] === -1) unsettled.push(c);
    // a counting metric at 0 has nothing to write; a gauge at 0 may lower its row
    else if (value > 0 || GAUGE_METRICS.has(c.metric)) rows.push({ tenantId, period: c.period, metric: c.metric, value: String(value) });
  });
  return { rows, unsettled };
}

/**
 * Retention purge: delete persisted usage rows older than `keepMonths`
 * (default 24). Meant for a scheduled job. Returns the number deleted.
 */
export async function purgeOldUsage(tenantId: string, keepMonths = 24): Promise<number> {
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - keepMonths);
  const cutoffMonth = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`;
  const res = await withTenantRepositoryFor(tenantId, TenantUsage, (repo) => repo
    .createQueryBuilder()
    .delete()
    .where('tenantId = :tenantId', { tenantId })
    .andWhere('month < :cutoffMonth', { cutoffMonth })
    .execute());
  return res.affected ?? 0;
}
