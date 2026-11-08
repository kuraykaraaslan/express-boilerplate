import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import ObservabilityService from '@kuraykaraaslan-labs/observability/server/observability.service';
import { TenantUsageUnbilledRow } from './entities/tenant_usage_unbilled.entity';
import { TenantUsageMetricRow } from './entities/tenant_usage_metric.entity';
import { getMetricDeclaration } from './tenant_usage.metrics';
import { flushToDb } from './tenant_usage.flush.service';
import { settleCounter } from './tenant_usage.reseed';
import { currentDay, currentMonth, dailyKey, redisKey } from './tenant_usage.keys';

/**
 * Lead decision D25 (docs/audits/2026-10-28-lead-decisions.md, S23.automation.57e): a quota reservation that meets a Redis
 * error keeps admitting (a lost device message is worse than a bill a few minutes late), and the units it could not count
 * are written to `tenant_usage_unbilled` instead of being lost. A release that cannot reach Redis writes its units back as a
 * negative row, so a message that was admitted, then refused by its producer, is not billed either.
 *
 * {@link reconcileUnbilled} applies a tenant's rows to the Redis counters and deletes them in one transaction: the flush job
 * runs it for every tenant before it flushes (the backstop, also for rows a process that died left behind), and a process that
 * wrote rows runs it for those tenants as soon as one of its reservations reaches Redis again.
 *
 * Visible in the scrape, never per tenant: `tenant_usage_unbilled_units_total{metric,outcome}` (`recorded`, `released`,
 * `reconciled`, `lost`: units neither Redis nor the table could keep) and `tenant_usage_unbilled_backlog_rows` (rows left
 * pending after the flush job's pass). The alerts are observability's `UsageUnbilledRecorded`, `UsageUnbilledLost` and
 * `UsageUnbilledBacklog` (alert-rules.ts).
 */

export type UnbilledOutcome = 'recorded' | 'released' | 'reconciled' | 'lost';

let unitsCounter: ReturnType<typeof ObservabilityService.counter> | null = null;
const unitsMetric = () => (unitsCounter ??= ObservabilityService.counter({
  name: 'tenant_usage_unbilled_units_total',
  help: 'Usage units a quota reservation or release could not count in Redis, by what became of them',
  labelNames: ['metric', 'outcome'],
}));
let backlogGauge: ReturnType<typeof ObservabilityService.gauge> | null = null;
const backlogMetric = () => (backlogGauge ??= ObservabilityService.gauge({
  name: 'tenant_usage_unbilled_backlog_rows', help: 'Unbilled usage rows still pending after the flush job reconciled every tenant',
}));

const count = (metric: string, outcome: UnbilledOutcome, units: number) => {
  if (units !== 0) unitsMetric().inc({ metric, outcome }, Math.abs(units));
};

/** Rows one reconcile pass takes per tenant; the next pass (or the next reservation) takes the rest. */
export const RECONCILE_BATCH = 1000;
/**
 * Passes one call runs for a tenant at most: a process that keeps writing rows as fast as they are reconciled (one still cut
 * off from Redis) cannot hold the flush job on one tenant; what is left is reported as backlog and taken by the next run.
 */
export const RECONCILE_MAX_PASSES = 50;
/** A process retries the tenants it owes at most this often while Redis answers again. */
export const RECONCILE_RETRY_MS = 10_000;
/**
 * How long the Redis-down quota check reuses a period's owed sum read from the ledger. The ledger grows by a row per message
 * while Redis is down, so a SUM per reservation would cost more the longer the outage lasts; within the window this process
 * adds the units it records itself, and rows other processes write meanwhile count from the next read.
 */
export const OWED_SUM_TTL_MS = 5_000;

/** Tenants this process wrote rows for and has not reconciled yet. */
const owed = new Set<string>();
let running: Promise<void> | null = null;
let lastAttempt = 0;

/** `tenantId|metric|period` -> the ledger's SUM when it was read, plus what this process recorded since. */
const owedSums = new Map<string, { at: number; read: Promise<number>; local: number }>();
const owedKey = (tenantId: string, metric: string, period: string) => `${tenantId}|${metric}|${period}`;
const forgetOwedSums = (tenantId: string) => {
  for (const key of owedSums.keys()) if (key.startsWith(`${tenantId}|`)) owedSums.delete(key);
};

/**
 * Writes `units` (signed) of `metric` for the counters of the current month and day. Never throws: a row that cannot be
 * written is logged and counted `lost`. That is a reservation the plan already admitted (the gate and the usage table were
 * read) whose insert then failed, or a release; when Postgres is down as a whole the reservation is refused before it gets
 * here, because a plan that cannot be read refuses (`onGateError: 'closed'`).
 */
export async function recordUnbilled(tenantId: string, metric: string, units: number): Promise<boolean> {
  if (!tenantId || units === 0) return true;
  const row = { tenantId, metric, month: currentMonth(), day: currentDay(), units };
  try {
    await withTenantRepositoryFor(tenantId, TenantUsageUnbilledRow, (repo) => repo.insert(row));
  } catch (err) {
    count(metric, 'lost', units);
    Logger.error(`[TenantUsage] ${units} unit(s) of ${metric} for ${tenantId} could not be counted in Redis nor recorded: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
  count(metric, units > 0 ? 'recorded' : 'released', units);
  owed.add(tenantId);
  for (const period of [row.month, row.day]) {
    const hit = owedSums.get(owedKey(tenantId, metric, period));
    if (hit) hit.local += units;
  }
  return true;
}

/**
 * The units of `metric` recorded and not yet reconciled for a period (`YYYY-MM` or `YYYY-MM-DD`), which the Redis-down quota
 * check adds to the table's value. The ledger's SUM is read at most once per {@link OWED_SUM_TTL_MS} per tenant, metric and
 * period (concurrent callers share the read), plus the units this process recorded since. 0 when the ledger cannot be read
 * (the check is best-effort while Redis is down).
 */
export async function pendingUnbilled(tenantId: string, metric: string, period: string, now: number = Date.now()): Promise<number> {
  const key = owedKey(tenantId, metric, period);
  let hit = owedSums.get(key);
  if (!hit || now - hit.at >= OWED_SUM_TTL_MS) {
    const where = period.length > 7 ? { tenantId, metric, day: period } : { tenantId, metric, month: period };
    const read = withTenantRepositoryFor(tenantId, TenantUsageUnbilledRow, (repo) => repo.sum('units', where))
      .then((sum) => Number(sum ?? 0), () => 0);
    hit = { at: now, read, local: 0 };
    // entries are only made while Redis is down; the stale ones go once there are many
    if (owedSums.size >= 1000) for (const [k, v] of owedSums) if (now - v.at >= OWED_SUM_TTL_MS) owedSums.delete(k);
    owedSums.set(key, hit);
  }
  return (await hit.read) + hit.local;
}

/** A counter the reconcile MULTI re-created (it has no TTL), to be settled once the transaction is over (D26). */
interface Recreated { key: string; metric: string; period: string }

export interface ReconcileResult {
  /** Rows applied and deleted. */
  rows: number;
  /** Net units applied. */
  units: number;
}

const groupBy = (rows: readonly TenantUsageUnbilledRow[], keyOf: (r: TenantUsageUnbilledRow) => string): Map<string, number> => {
  const out = new Map<string, number>();
  for (const r of rows) out.set(keyOf(r), (out.get(keyOf(r)) ?? 0) + r.units);
  return out;
};

/**
 * Applies up to {@link RECONCILE_BATCH} of a tenant's rows and deletes them, in one tenant transaction: the rows are locked
 * (another process skips them) and deleted, and the Redis MULTI (every month and day counter they name) runs last, so a Redis
 * error rolls the delete back and the rows wait for the next pass. A month that is over is flushed to the table afterwards (the
 * hourly flush only writes the current month). A month that is over and whose Redis counter has expired goes to the table row
 * itself: a re-created counter would hold only these units, and a flush would overwrite the month's row with them. A command
 * of the MULTI that Redis refuses alone does not roll back (Redis applied the rest): its units are counted `lost`. A counter
 * the MULTI re-created (Redis lost it: it has no TTL) gets the period's stored value back and its TTL once the transaction is
 * over (D26, tenant_usage.reseed.ts).
 * Throws when Redis or the table fails.
 */
export async function reconcileUnbilled(tenantId: string): Promise<ReconcileResult> {
  const current = currentMonth();
  const flush = new Set<string>();
  const out = await withTenantTransactionFor(tenantId, async (qr) => {
    const ledger = qr.manager.getRepository(TenantUsageUnbilledRow);
    const rows = await ledger.find({
      where: { tenantId }, order: { createdAt: 'ASC' }, take: RECONCILE_BATCH, lock: { mode: 'pessimistic_write', onLocked: 'skip_locked' },
    });
    if (rows.length === 0) return { rows: 0, units: 0, byMetric: new Map<string, number>(), lost: new Map<string, number>(), created: [] as Recreated[] };
    const expired = new Set<string>();
    for (const key of groupBy(rows.filter((r) => r.month !== current), (r) => `${r.metric}|${r.month}`).keys()) {
      const [metric, month] = key.split('|') as [string, string];
      if ((await redis.exists(redisKey(tenantId, metric, month))) === 0) expired.add(key);
    }
    const toTable = rows.filter((r) => expired.has(`${r.metric}|${r.month}`));
    const toRedis = rows.filter((r) => !expired.has(`${r.metric}|${r.month}`));
    for (const r of toRedis) if (r.month !== current) flush.add(r.month);

    await ledger.delete(rows.map((r) => r.unbilledId));
    if (toTable.length) {
      const table = qr.manager.getRepository(TenantUsageMetricRow);
      const periodOf = new Map<string, 'month' | 'day'>();
      for (const metric of new Set(toTable.map((r) => r.metric))) periodOf.set(metric, (await getMetricDeclaration(metric))?.period === 'day' ? 'day' : 'month');
      for (const [key, n] of groupBy(toTable, (r) => `${r.metric}|${periodOf.get(r.metric) === 'day' ? r.day : r.month}`)) {
        const [metric, period] = key.split('|') as [string, string];
        const row = await table.findOne({ where: { tenantId, period, metric }, lock: { mode: 'pessimistic_write' } });
        if (row) await table.update({ usageMetricId: row.usageMetricId }, { value: String(Math.max(0, Number(row.value) + n)) });
        else if (n > 0) await table.insert({ tenantId, period, metric, value: String(n) });
      }
    }
    const lost = new Map<string, number>();
    const created: Recreated[] = [];
    if (toRedis.length) {
      // the counter each metric is billed from (flushToDb): the month's, or the day's for a day metric
      const daily = new Set<string>();
      for (const metric of new Set(toRedis.map((r) => r.metric))) if ((await getMetricDeclaration(metric))?.period === 'day') daily.add(metric);
      const queued: Array<Recreated & { n: number; bills: boolean }> = [];
      for (const [key, n] of groupBy(toRedis, (r) => `${r.metric}|${r.month}`)) {
        const [metric, month] = key.split('|') as [string, string];
        queued.push({ key: redisKey(tenantId, metric, month), metric, period: month, n, bills: !daily.has(metric) });
      }
      for (const [key, n] of groupBy(toRedis, (r) => `${r.metric}|${r.day}`)) {
        const [metric, day] = key.split('|') as [string, string];
        queued.push({ key: dailyKey(tenantId, metric, day), metric, period: day, n, bills: daily.has(metric) });
      }
      const applied = queued.filter((q) => q.n !== 0);
      const tx = redis.multi();
      // the TTL is read, not set: a counter with none is one a count re-created, settled after the commit (D26)
      for (const q of applied) tx.incrby(q.key, q.n).ttl(q.key);
      // a reply that never came, or an aborted MULTI (null): nothing is known to be applied, so the delete is rolled back
      const replies = await tx.exec();
      if (!replies) throw new Error('the reconcile MULTI was aborted');
      // Redis applies the other commands of a MULTI when one fails (a counter holding a non-integer, an overflow): keeping
      // the rows would add those units again on every pass, so the rows go and the failed counter's units are counted lost
      applied.forEach((q, i) => {
        const [err] = replies[i * 2] ?? [];
        if (!err && replies[i * 2 + 1]?.[1] === -1) created.push({ key: q.key, metric: q.metric, period: q.period });
        if (!err) return;
        Logger.error(`[TenantUsage] reconcile could not add ${q.n} unit(s) to ${q.key}: ${err.message}`);
        if (q.bills) lost.set(q.metric, (lost.get(q.metric) ?? 0) + q.n);
      });
    }
    const byMetric = groupBy(rows, (r) => r.metric);
    return { rows: rows.length, units: [...byMetric.values()].reduce((a, b) => a + b, 0), byMetric, lost, created };
  });
  forgetOwedSums(tenantId);
  for (const c of out.created) await settleCounter(tenantId, c.metric, c.period, c.key);
  for (const [metric, units] of out.byMetric) count(metric, 'reconciled', units - (out.lost.get(metric) ?? 0));
  for (const [metric, units] of out.lost) count(metric, 'lost', units);
  for (const month of flush) {
    await flushToDb(tenantId, month).catch((err: unknown) => Logger.warn(`[TenantUsage] flush of ${month} after reconcile failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`));
  }
  return { rows: out.rows, units: out.units };
}

/**
 * Called by a reservation that reached Redis: when this process owes reconciles, run them (one at a time, at most every
 * {@link RECONCILE_RETRY_MS}). Never throws, never awaited by the reservation.
 */
export function reconcileOwedSoon(now: number = Date.now()): void {
  if (owed.size === 0 || running || now - lastAttempt < RECONCILE_RETRY_MS) return;
  lastAttempt = now;
  running = (async () => {
    for (const tenantId of [...owed]) {
      try {
        for (let pass = 0; pass < RECONCILE_MAX_PASSES; pass++) {
          const r = await reconcileUnbilled(tenantId);
          if (r.rows < RECONCILE_BATCH) { owed.delete(tenantId); break; }
        }
      } catch (err) {
        Logger.warn(`[TenantUsage] reconcile of unbilled usage failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  })().finally(() => { running = null; });
}

/**
 * The flush job's pass for one tenant: reconcile until nothing is left, a pass fails or `maxPasses` ran. Returns the rows still
 * pending, which the job sums into `tenant_usage_unbilled_backlog_rows`. Never throws.
 */
export async function reconcileTenant(tenantId: string, maxPasses: number = RECONCILE_MAX_PASSES): Promise<number> {
  const pending = () => withTenantRepositoryFor(tenantId, TenantUsageUnbilledRow, (repo) => repo.count({ where: { tenantId } }));
  try {
    for (let pass = 0; pass < maxPasses; pass++) {
      const r = await reconcileUnbilled(tenantId);
      if (r.rows < RECONCILE_BATCH) {
        owed.delete(tenantId);
        return 0;
      }
    }
    // still a full batch after the last pass: rows arrive as fast as they go; the next run takes the rest
    return await pending().catch(() => 1);
  } catch (err) {
    Logger.warn(`[TenantUsage] reconcile of unbilled usage failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
    // a count that cannot be read is reported as pending, so the backlog alert still sees the failing tenant
    return pending().catch(() => 1);
  }
}

/** The flush job reports what is still pending after it went through every tenant. */
export function reportUnbilledBacklog(rows: number): void {
  backlogMetric().set(undefined, rows);
}

/** Test seam. */
export async function _resetUnbilledForTests(): Promise<void> {
  await running;
  owed.clear();
  owedSums.clear();
  lastAttempt = 0;
}
