import 'reflect-metadata';
import { Client } from 'pg';
import Logger from '@kuraykaraaslan-labs/logger';
import { withSystemRLS } from './db.rls';
import { parseDbUrl } from './db.utils';
import { resolveTenantDatabaseUrl } from './db.tenant-database.url';
import { loadTimeSeriesTables, runTimeSeriesRetention, type TimeSeriesTable } from './db.time-series';
import { runTimeSeriesRollups, summarizeRollupReports, type RollupLagAlert, type RollupRunOptions } from './db.time-series.rollup';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';

/**
 * `db-time-series-retention` (docs/phases/10-db phase 5 §5.4): the retention pass for
 * every declared time-series table, in the system database and in every tenant
 * database registered in `tenant_databases`.
 *
 *  - Self-hosted: `scheduleTimeSeriesRetentionJob()` at boot (instrumentation).
 *  - Serverless: POST /api/cron/time-series-retention with the CRON_SECRET bearer.
 *
 * Retention is platform-declared here. A per-tenant retention setting, if a
 * consumer wants one, follows the owner rule in `docs/phases/README.md`: announce
 * first, then delete.
 */
const QUEUE_NAME = 'db-time-series-retention';

export interface TimeSeriesRetentionSummary { databases: number; tables: number; failed: number }

async function sweepSystemDb(tables: TimeSeriesTable[], summary: TimeSeriesRetentionSummary): Promise<void> {
  summary.databases += 1;
  for (const t of tables) {
    try {
      // One transaction per table: a failed statement (e.g. drop_chunks without
      // ownership) aborts its own transaction, not the rest of the sweep.
      await withSystemRLS((qr) => runTimeSeriesRetention(qr, [t]));
      summary.tables += 1;
    } catch (err) {
      summary.failed += 1;
      Logger.warn(`[CronJob:${QUEUE_NAME}] ${t.table} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function sweepTenantDbs(tables: TimeSeriesTable[], summary: TimeSeriesRetentionSummary): Promise<void> {
  let urls: string[] = [];
  try {
    const { default: TenantDatabaseService } = await import('./db.tenant-provision.service');
    const rows = (await TenantDatabaseService.listAll()).filter((r) => r.status !== 'DROPPED');
    // One row whose DSN cannot be read (e.g. ciphertext without its key) must not hide every other database.
    urls = [...new Set(rows.flatMap((r) => {
      try { return [resolveTenantDatabaseUrl(r, (m) => Logger.warn(m))]; } catch (err) {
        summary.failed += 1;
        Logger.warn(`[CronJob:${QUEUE_NAME}] tenant database unreadable: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    }))];
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] tenant databases unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }
  for (const raw of urls) {
    const { url, schema } = parseDbUrl(raw);
    const client = new Client({ connectionString: url });
    try {
      await client.connect();
      if (schema) await client.query(`SET search_path TO "${schema}", public`);
      await runTimeSeriesRetention(client, tables);
      summary.databases += 1;
      summary.tables += tables.length;
    } catch (err) {
      summary.failed += 1;
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant database failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

/** One full pass. Shared by the worker and the cron HTTP twin. */
export async function runTimeSeriesRetentionSweep(): Promise<TimeSeriesRetentionSummary> {
  const summary: TimeSeriesRetentionSummary = { databases: 0, tables: 0, failed: 0 };
  const tables = (await loadTimeSeriesTables()).filter((t) => t.retention || t.rollups?.some((r) => r.retention));
  if (tables.length === 0) return summary;
  await sweepSystemDb(tables, summary);
  await sweepTenantDbs(tables, summary);
  Logger.info(`[CronJob:${QUEUE_NAME}] databases=${summary.databases} tables=${summary.tables} failed=${summary.failed}`);
  return summary;
}

let _scheduled = false;

export async function scheduleTimeSeriesRetentionJob(cronPattern = '17 * * * *'): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  const [{ Queue, Worker }, { getBullMQConnection }] = await Promise.all([
    import('bullmq'),
    import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
  ]);
  const queue = new Queue(QUEUE_NAME, {
    connection: getBullMQConnection(),
    defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
  });
  const worker = new Worker(QUEUE_NAME, async () => runTimeSeriesRetentionSweep(), {
    connection: getBullMQConnection(), concurrency: 1,
  });
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  await queue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: `${QUEUE_NAME}-recurring` });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`);
}

// ─── rollups (docs/phases/10-db phase 5 section 5.7) ────────────────────────────────

const ROLLUP_QUEUE = 'db-time-series-rollup';
/** A pass must finish inside its one-minute schedule: stop starting transactions after this; the remainder resumes next minute. */
const ROLLUP_RUN_BUDGET_MS = 50_000;
const ROLLUP_LOCK_TTL_S = 90;

export interface TimeSeriesRollupSummary {
  rollups: number; runs: number; rows: number; failed: number;
  /** (tenant, rollup) pairs that did work, were cut by the budget, or were skipped because another run holds them. */
  active: number; truncated: number; busy: number;
  /** Worst lag behind the newest closed bucket over all tenants after the pass, in buckets and ms (0 = caught up). */
  maxLagBuckets: number; maxLagMs: number; lagged: number;
  durationMs: number;
  /** True when the pass was skipped because the previous one in this process is still running. */
  skipped?: boolean;
}

let _rollupRunning = false;

/** Cross-pod lock per rollup (Redis SET NX EX). Fail-open when Redis is unavailable: the per-step advisory locks still prevent duplicate work. */
async function redisRunLock(rollup: string): Promise<null | (() => Promise<void>)> {
  try {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    const key = `lock:ts-rollup:${rollup}`;
    const token = `${process.pid}:${Date.now()}`;
    const ok = await redis.set(key, token, 'EX', ROLLUP_LOCK_TTL_S, 'NX');
    if (ok !== 'OK') return null;
    return async () => { if ((await redis.get(key)) === token) await redis.del(key); };
  } catch {
    return async () => undefined;
  }
}

/**
 * Lag alert: a (tenant, rollup) whose watermark is more than `maxLagBuckets` (default 5, per rollup override) behind
 * the newest closed bucket. Logged at error level, then handed to the handler the app registered with
 * `setRollupLagHandler` (if any). Pass your own `onLag` to a sweep to override both.
 */
let lagHandler: ((a: RollupLagAlert) => void | Promise<void>) | null = null;

/**
 * `db` is infrastructure and must not import `observability` (which depends on it), so the app registers the
 * escalation (Sentry fingerprint, incident, ...) here at boot; see observability/server/observability.time-series-boot.ts.
 */
export function setRollupLagHandler(fn: ((a: RollupLagAlert) => void | Promise<void>) | null): void {
  lagHandler = fn;
}

async function defaultLagAlert(a: RollupLagAlert): Promise<void> {
  const msg = `rollup ${a.rollup} tenant ${a.tenantId} lags ${a.lagBuckets} buckets (${Math.round(a.lagMs / 1000)} s, threshold ${a.threshold})`;
  Logger.error(`[CronJob:${ROLLUP_QUEUE}] LAG ${msg}`);
  try { await lagHandler?.(a); } catch { /* an alert sink must never break the rollup pass */ }
}

/**
 * `db-time-series-rollup`: incrementally maintain every declared rollup, one
 * tenant at a time inside `withTenantTransactionFor` (RLS applies, tenants are
 * never mixed, and a tenant on a dedicated database is reached through its own
 * DataSource). The ONLY cross-tenant read is the list of active tenant ids.
 * Self-hosted: `scheduleTimeSeriesRollupJob()`; serverless:
 * POST /api/cron/time-series-rollup (every minute).
 *
 * The pass is bounded (`ROLLUP_RUN_BUDGET_MS`, `maxSlicesPerRun`), never overlaps itself (in-process flag + Redis lock per
 * rollup + per-(rollup, tenant) advisory lock) and resumes from the committed watermark / dirty queue next minute.
 * The summary reports the worst lag; lagging rollups raise the alert hook.
 */
export async function runTimeSeriesRollupSweep(opts: Partial<Pick<RollupRunOptions, 'maxRunMs' | 'maxSlicesPerRun' | 'lagAlertBuckets' | 'onLag' | 'now'>> = {}): Promise<TimeSeriesRollupSummary> {
  const summary: TimeSeriesRollupSummary = {
    rollups: 0, runs: 0, rows: 0, failed: 0, active: 0, truncated: 0, busy: 0, maxLagBuckets: 0, maxLagMs: 0, lagged: 0, durationMs: 0,
  };
  if (_rollupRunning) { summary.skipped = true; Logger.warn(`[CronJob:${ROLLUP_QUEUE}] previous pass still running, skipped`); return summary; }
  const started = Date.now();
  _rollupRunning = true;
  try {
    const tables = (await loadTimeSeriesTables()).filter((t) => (t.rollups?.length ?? 0) > 0);
    if (tables.length === 0) return summary;
    const { withTenantTransactionFor } = await import('./db.context');
    let lagged = 0;
    const reports = await runTimeSeriesRollups(tables, {
      tenants: async () => withSystemRLS(async (qr) => {
        const rows: { tenantId: string }[] = await qr.query(`SELECT "tenantId" FROM "tenants" WHERE "tenantStatus" = 'ACTIVE'`);
        return rows.map((r) => r.tenantId);
      }),
      scope: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
      maxRunMs: opts.maxRunMs ?? ROLLUP_RUN_BUDGET_MS,
      maxSlicesPerRun: opts.maxSlicesPerRun,
      lagAlertBuckets: opts.lagAlertBuckets,
      now: opts.now,
      runLock: redisRunLock,
      onLag: async (a) => { lagged += 1; await (opts.onLag ?? defaultLagAlert)(a); },
    });
    summary.rollups = tables.reduce((n, t) => n + (t.rollups?.length ?? 0), 0);
    for (const r of reports) {
      summary.runs += 1; summary.rows += r.rows; if (r.error) summary.failed += 1;
      if (r.slices > 0) summary.active += 1;
    }
    const agg = summarizeRollupReports(reports);
    summary.truncated = agg.truncated; summary.busy = agg.busy; summary.maxLagBuckets = agg.maxLagBuckets; summary.maxLagMs = agg.maxLagMs;
    summary.lagged = lagged;
    summary.durationMs = Date.now() - started;
    Logger.info(
      `[CronJob:${ROLLUP_QUEUE}] rollups=${summary.rollups} runs=${summary.runs} active=${summary.active} rows=${summary.rows} failed=${summary.failed} ` +
      `truncated=${summary.truncated} busy=${summary.busy} maxLagBuckets=${summary.maxLagBuckets} lagged=${summary.lagged} durationMs=${summary.durationMs}`,
    );
    return summary;
  } finally {
    _rollupRunning = false;
  }
}

let _rollupScheduled = false;

export async function scheduleTimeSeriesRollupJob(cronPattern = '* * * * *'): Promise<void> {
  if (_rollupScheduled) return;
  _rollupScheduled = true;
  const [{ Queue, Worker }, { getBullMQConnection }] = await Promise.all([
    import('bullmq'),
    import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
  ]);
  const queue = new Queue(ROLLUP_QUEUE, {
    connection: getBullMQConnection(),
    defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
  });
  const worker = new Worker(ROLLUP_QUEUE, async () => runTimeSeriesRollupSweep(), {
    connection: getBullMQConnection(), concurrency: 1,
  });
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${ROLLUP_QUEUE}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  await queue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: `${ROLLUP_QUEUE}-recurring` });
  Logger.info(`[CronJob:${ROLLUP_QUEUE}] Scheduled with pattern: ${cronPattern}`);
}
