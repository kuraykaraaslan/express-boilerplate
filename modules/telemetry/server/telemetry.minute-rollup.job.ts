import Logger from '@kuraykaraaslan-labs/logger';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { DEFAULT_LANE } from './telemetry.contract';
import { BINDINGS_TABLE } from './telemetry.classes';
import { ensureTelemetryKindsLoaded, kindsOfLane, registeredTelemetryKinds, laneOf } from './telemetry.kinds';
import { runMinuteRollups, type MinuteRunReport } from './telemetry.minute-rollup';
import { TELEMETRY_LANES } from './telemetry.timeseries';
import { processTouchedPairs } from './telemetry.writer';
import { DEFAULT_ROLLUP_FULL_SWEEP_EVERY, getTelemetryPolicy } from './telemetry.settings-policy';

/**
 * `telemetry-minute-rollup` (docs/phases/42-telemetry/00 §0.8b, ED-12): the 1-minute aggregates, every minute, one BullMQ job per
 * lane, as this module's `common:boot_task` (phase `scheduler`, single owner: the leader of the cluster). One pass is bounded
 * (50 s, 30 steps per tenant and class) and never overlaps itself (an in-process flag and a per-lane-tenant-class advisory lock);
 * what is left resumes on the next minute from the committed watermark and hint queue.
 *
 * Which pairs a pass visits: the ones the writer touched in the last minutes (the Redis set), so an idle tenant or class costs
 * nothing; every `FULL_SWEEP_EVERY` runs, and whenever Redis cannot answer, the pass visits every tenant that ever wrote telemetry
 * (the ones with a class binding in the shared database, plus every tenant with a database of its own) × the classes its bindings
 * name for the lane's kinds. The only cross-tenant read is that list.
 *
 * The DB share, the steps per tenant and class and the full-sweep period are the ROOT tenant's settings when set
 * (telemetry.settings-policy.ts, read once per pass); unset they are the constants below and runMinuteRollups' defaults.
 */
const QUEUE = 'telemetry-minute-rollup';
export const MINUTE_RUN_BUDGET_MS = 50_000;
export const FULL_SWEEP_EVERY = DEFAULT_ROLLUP_FULL_SWEEP_EVERY;

export interface MinuteRollupSummary {
  lane: string;
  tenants: number;
  steps: number;
  rows: number;
  failed: number;
  truncated: number;
  busy: number;
  durationMs: number;
  fullSweep: boolean;
  skipped?: boolean;
}

const queueOf = (lane: string): string => (lane === DEFAULT_LANE ? QUEUE : `${QUEUE}-${lane}`);

/** Tenants with telemetry on the shared database, and tenants with their own database. */
export async function minuteRollupTenants(): Promise<string[]> {
  const out = new Set<string>();
  const { withSystemRLS } = await import('@kuraykaraaslan-labs/db/server/db.rls');
  const rows = await withSystemRLS(async (qr) => (await qr.query(`SELECT DISTINCT "tenantId" FROM "${BINDINGS_TABLE}"`)) as Array<{ tenantId: string }>);
  for (const r of rows) out.add(r.tenantId);
  try {
    const { TenantDatabaseService } = await import('@kuraykaraaslan-labs/db/server');
    for (const r of await TenantDatabaseService.listAll()) if (r.status === 'ACTIVE') out.add(r.tenantId);
  } catch (e) {
    Logger.warn(`[CronJob:${QUEUE}] tenant databases unavailable: ${e instanceof Error ? e.message : String(e)}`);
  }
  return [...out];
}

/**
 * The kinds whose bindings a lane's full sweep reads: the lane's registered kinds, plus (default lane only) every kind no
 * registered module claims, so a kind whose module is disabled still gets its minutes aggregated. `null` = no filter.
 */
function kindsFilterOf(lane: string): readonly string[] | null {
  if (lane === DEFAULT_LANE) {
    const elsewhere = registeredTelemetryKinds().filter((k) => laneOf(k) !== DEFAULT_LANE);
    return elsewhere.length ? null : null; // the default lane takes everything not claimed by another lane; see note below
  }
  return kindsOfLane(lane);
}

const running = new Set<string>();
const runs = new Map<string, number>();

export async function runTelemetryMinuteRollup(opts: { lane?: string; now?: Date; maxRunMs?: number; fullSweep?: boolean } = {}): Promise<MinuteRollupSummary> {
  const lane = opts.lane ?? DEFAULT_LANE;
  const queue = queueOf(lane);
  const n = (runs.get(lane) ?? 0) + 1;
  runs.set(lane, n);
  const policy = await getTelemetryPolicy();
  // the first pass and every `rollupFullSweepEvery`-th after it (15: passes 1, 16, 31, … as before)
  const fullSweep = opts.fullSweep ?? (n - 1) % policy.rollupFullSweepEvery === 0;
  const summary: MinuteRollupSummary = { lane, tenants: 0, steps: 0, rows: 0, failed: 0, truncated: 0, busy: 0, durationMs: 0, fullSweep };
  if (running.has(lane)) {
    summary.skipped = true;
    Logger.warn(`[CronJob:${queue}] previous pass still running, skipped`);
    return summary;
  }
  running.add(lane);
  const started = Date.now();
  try {
    await ensureTelemetryKindsLoaded();
    const [{ withTenantTransactionFor }, { timeSeriesAccessRel }, { markRollupDirty }] = await Promise.all([
      import('@kuraykaraaslan-labs/db/server/db.context'),
      import('@kuraykaraaslan-labs/db/server/db.time-series'),
      import('@kuraykaraaslan-labs/db/server/db.time-series.rollup'),
    ]);
    const touched = processTouchedPairs();
    const reports: MinuteRunReport[] = await runMinuteRollups({
      lane,
      tenants: minuteRollupTenants,
      pairs: fullSweep ? undefined : () => touched.pairs(lane),
      kinds: kindsFilterOf(lane),
      scope: (tenantId, fn) => withTenantTransactionFor(tenantId, (qr) => fn(qr)),
      accessRel: (db, table) => timeSeriesAccessRel(db, table),
      markRollupDirty: (db, t, tenantId, minTs, maxTs, now) => markRollupDirty(db, t, tenantId, minTs, maxTs, now),
      now: opts.now,
      maxRunMs: opts.maxRunMs ?? MINUTE_RUN_BUDGET_MS,
      maxSteps: policy.rollupMaxSteps,
      dbShare: policy.rollupDbShare,
    });
    summary.tenants = new Set(reports.map((r) => r.tenantId)).size;
    for (const r of reports) {
      summary.steps += r.steps;
      summary.rows += r.rows;
      if (r.error) {
        summary.failed += 1;
        Logger.warn(`[CronJob:${queue}] tenant ${r.tenantId} class ${r.classDays} failed: ${r.error}`);
      }
      if (r.truncated) summary.truncated += 1;
      if (r.busy) summary.busy += 1;
    }
    summary.durationMs = Date.now() - started;
    if (summary.steps || summary.failed) {
      Logger.info(`[CronJob:${queue}] lane=${lane} sweep=${fullSweep ? 'full' : 'touched'} tenants=${summary.tenants} steps=${summary.steps} rows=${summary.rows} failed=${summary.failed} truncated=${summary.truncated} busy=${summary.busy} durationMs=${summary.durationMs}`);
    }
    return summary;
  } finally {
    running.delete(lane);
  }
}

const scheduled = new Set<string>();

/** The boot task (`module.json`, `common:boot_task`, phase `scheduler`): a repeatable BullMQ job every minute, one per lane. */
export async function scheduleTelemetryMinuteRollupJob(cronPattern = '* * * * *'): Promise<void> {
  const [{ Queue, Worker }, { getBullMQConnection }] = await Promise.all([
    import('bullmq'),
    import('@kuraykaraaslan-labs/redis/server/redis.bullmq'),
  ]);
  for (const lane of TELEMETRY_LANES) {
    if (scheduled.has(lane)) continue;
    scheduled.add(lane);
    const name = queueOf(lane);
    const queue = new Queue(name, { connection: getBullMQConnection(), defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } });
    const worker = new Worker(name, async () => runTelemetryMinuteRollup({ lane }), { connection: getBullMQConnection(), concurrency: 1 });
    worker.on('failed', (job, err) => Logger.error(`[CronJob:${name}] Job ${job?.id} failed: ${err.message}`));
    registerWorkerDrain(worker);
    await queue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: `${name}-recurring` });
    Logger.info(`[CronJob:${name}] Scheduled with pattern: ${cronPattern}`);
  }
}
