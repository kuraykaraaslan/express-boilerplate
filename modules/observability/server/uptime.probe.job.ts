import 'reflect-metadata'
import type { Worker } from 'bullmq'
import { IsNull, LessThanOrEqual, Or } from 'typeorm'
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context'
import { Monitor } from './entities/monitor.entity'
import MonitorService from './uptime.monitor.service'
import { syncProbeTargets } from './uptime.probe-target.service'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'
import { getLastSweep, recordSweep } from './uptime.sweep-state'
import { interleave } from './observability.fairness'
import { LOCAL_LOCATION } from './probe.quorum'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'

/**
 * The probe scheduler (phase 0.2, the last open half): a minutely BullMQ tick
 * that probes every ACTIVE monitor whose own `intervalSeconds` has elapsed.
 * Per-monitor cadence lives on the ROW — the tick is just the metronome, so a
 * 60s monitor and a 15min monitor coexist under one repeatable job instead of
 * one BullMQ repeatable per monitor (which would leak orphaned repeatables on
 * every monitor edit/delete).
 *
 *  - Self-hosted: `scheduleUptimeProbeJob()` at boot (instrumentation.ts).
 *  - Serverless: POST /api/cron/uptime-probe with the CRON_SECRET bearer.
 *
 * Tenant enumeration goes through the `tenant` module the way the maintenance
 * bridge reads windows: a dynamic import recorded in ACCEPTED_FORWARD_DRIFT
 * (`observability->tenant`) — on a deployment without the tenancy module the
 * sweep quietly does nothing, which is correct: no tenants, no monitors.
 */
const QUEUE_NAME = 'observability-uptime-probe'

/**
 * How a sweep spends its minute (phase 16.5, measured in docs/phases/09-observability/SCORECARD.md).
 *
 * The first version probed ONE monitor at a time under a ceiling of 500 probes: a minute's work for ~25 000 healthy local probes was impossible, and one
 * outage that took down 200 monitors made the sweep last 200 seconds (each newly DOWN monitor opens an alert, an incident and a page inline). Now probes run
 * in a small pool, fairly across tenants:
 *  - `concurrency`: probes in flight at once, sweep-wide (a ceiling on what one process asks of the database and the network);
 *  - `perTenant`: probes in flight for ONE tenant, so a tenant with thousands of due monitors cannot take every slot from the others;
 *  - `budgetMs`: no new probe is STARTED after this, so a sweep always ends inside its minute; what was not started waits for the next tick (counted, and
 *    shown to the operator as `truncated`);
 *  - `maxProbes`: the runaway-monitor-count ceiling that used to be 500 (20 000 now: at 8 probes in flight a local probe takes ~3 ms of pool time, so the budget, not this number, is what ends a sweep).
 */
export interface SweepTuning { concurrency: number; perTenant: number; budgetMs: number; maxProbes: number }
export const DEFAULT_SWEEP_TUNING: SweepTuning = { concurrency: 8, perTenant: 4, budgetMs: 50_000, maxProbes: 20_000 }
let tuning: SweepTuning = DEFAULT_SWEEP_TUNING
/** Test and measurement seam. */
export function setSweepTuning(t?: Partial<SweepTuning>): void { tuning = t ? { ...DEFAULT_SWEEP_TUNING, ...t } : DEFAULT_SWEEP_TUNING }
export function getSweepTuning(): SweepTuning { return tuning }

/**
 * A probe is stamped when it RUNS, up to a whole sweep after the sweep started, and the next sweep starts exactly one tick later: without slack a 60-second
 * monitor was found "not due yet" at every second tick and probed every 120 seconds (measured: 119 s average gap; with a fixed 20 s of slack and a
 * 10 000-monitor sweep that lasts 43 s, 61 % of the monitors were still skipped at the next tick). A monitor is due when it would be due within the slack;
 * the slack follows the LAST sweep's own duration (plus five seconds), between `DUE_SLACK_MS` and `DUE_SLACK_MAX_MS`. The database filter still keeps any
 * monitor from being probed twice within 15 s.
 */
export const DUE_SLACK_MS = 20_000
export const DUE_SLACK_MAX_MS = 45_000
export function dueSlackFor(lastSweepMs: number | undefined): number {
  return Math.min(DUE_SLACK_MAX_MS, Math.max(DUE_SLACK_MS, (lastSweepMs ?? 0) + 5_000))
}

export { interleave }

/**
 * How often one tenant's module-contributed probe targets are reconciled. The probes need the minutely tick; the target
 * list does not: it changes when a provider is installed, configured or removed, and the reconcile loads every provider
 * plus the tenant's whole monitor table. Ten minutes bounds how late a new provider endpoint starts being probed.
 */
export const PROBE_TARGET_SYNC_INTERVAL_MS = 10 * 60_000

/**
 * Last successful target sync per tenant, in this process. Per process on purpose: a fresh worker (or a serverless
 * instance of the HTTP twin) syncs on its first tick, exactly as before, and a failed sync is retried on the next tick.
 */
const lastTargetSync = new Map<string, number>()

function targetSyncDue(tenantId: string, now: Date): boolean {
  const last = lastTargetSync.get(tenantId)
  return last === undefined || now.getTime() - last >= PROBE_TARGET_SYNC_INTERVAL_MS
}

export interface ProbeSweepSummary {
  tenants: number
  due: number
  probed: number
  failed: number
  truncated: boolean
}

/** Is this monitor due at `now`? Never-checked counts as due. */
export function isDue(monitor: Pick<Monitor, 'intervalSeconds' | 'lastCheckedAt'>, now: Date, slackMs: number = DUE_SLACK_MS): boolean {
  if (!monitor.lastCheckedAt) return true
  return new Date(monitor.lastCheckedAt).getTime() + monitor.intervalSeconds * 1000 <= now.getTime() + slackMs
}

async function listActiveTenantIds(): Promise<string[]> {
  try {
    // Still a dynamic import: observability stays installable without tenant.
    // The helper reads on the SYSTEM DataSource — see tenant.sweep.ts.
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep')
    const rows = await listActiveTenants()
    return rows.map((t) => t.tenantId)
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] tenant enumeration unavailable (empty sweep): ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/** One full sweep. Shared by the BullMQ worker and the cron HTTP twin. */
export async function runProbeSweep(now: Date = new Date()): Promise<ProbeSweepSummary> {
  const tenantIds = await listActiveTenantIds()
  const summary: ProbeSweepSummary = { tenants: tenantIds.length, due: 0, probed: 0, failed: 0, truncated: false }
  const sweepStarted = Date.now()
  const slack = dueSlackFor(getLastSweep()?.ms)

  // 1. What is due, per tenant. Nothing is probed yet, so no tenant's backlog can use up the sweep before the next tenant is even looked at.
  const dueByTenant: Array<Array<{ tenantId: string; monitorId: string }>> = []
  for (const tenantId of tenantIds) {
    try {
      // Module-contributed targets first (on their slower cadence), so a synced endpoint is probed in the same tick. Never blocks the sweep.
      if (targetSyncDue(tenantId, now)) {
        await syncProbeTargets(tenantId).then(
          () => { lastTargetSync.set(tenantId, now.getTime()) },
          (err) => Logger.warn(`[CronJob:${QUEUE_NAME}] probe-target sync failed for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`),
        )
      }
      // The DB narrows to "possibly due" (never-checked or older than the
      // MINIMUM interval); the exact per-row cadence check is `isDue`. Each
      // probe then runs in its own blocks (it is network I/O).
      const candidates = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.find({
        where: {
          tenantId, isActive: true,
          lastCheckedAt: Or(IsNull(), LessThanOrEqual(new Date(now.getTime() - 15_000))),
        },
      }))
      const due = candidates
        // Pause-until: the monitor stays active but is skipped until the time passes, then resumes by itself.
        .filter((m) => isDue(m, now, slack) && !(m.pausedUntil && new Date(m.pausedUntil).getTime() > now.getTime()))
        // A monitor that runs from probe locations only (it names some, and not `local`) is for the runners: the in-process sweep leaves it alone.
        .filter((m) => !(m.locations?.length && !m.locations.includes(LOCAL_LOCATION)))
        // A BROWSER monitor is NEVER run by the app process, whatever its locations say (D-OBS-8): only a browser-capable runner leases it.
        .filter((m) => m.type !== 'BROWSER')
        // Longest-waiting first inside a tenant, so a truncated sweep catches up in order rather than re-probing the same head.
        .sort((a, b) => (a.lastCheckedAt ? new Date(a.lastCheckedAt).getTime() : 0) - (b.lastCheckedAt ? new Date(b.lastCheckedAt).getTime() : 0))
        .map((m) => ({ tenantId, monitorId: m.monitorId }))
      summary.due += due.length
      if (due.length) dueByTenant.push(due)
    } catch (err) {
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // 2. Probe fairly, in a small pool: tenant by tenant in rounds (`interleave` order), at most `perTenant` in flight per tenant and `concurrency` overall,
  //    and no new probe started once the sweep's time budget or its ceiling is spent. (Probe runs are metered where the check row is written, `recordOutcome`.)
  const t = tuning
  const started = Date.now()
  const queues = dueByTenant.map((q) => [...q])
  const inflight = new Map<string, number>()
  let cursor = 0
  let startedCount = 0
  const exhausted = () => queues.every((q) => q.length === 0)
  const take = (): { tenantId: string; monitorId: string } | null => {
    for (let n = 0; n < queues.length; n += 1) {
      const idx = (cursor + n) % queues.length
      const q = queues[idx]
      if (q.length === 0 || (inflight.get(q[0].tenantId) ?? 0) >= t.perTenant) continue
      cursor = (idx + 1) % queues.length
      return q.shift()!
    }
    return null
  }
  await new Promise<void>((resolve) => {
    let running = 0
    const pump = (): void => {
      while (running < t.concurrency) {
        if (startedCount >= t.maxProbes || Date.now() - started > t.budgetMs) {
          if (!exhausted()) summary.truncated = true
          break
        }
        const item = take()
        if (!item) break
        startedCount += 1; running += 1
        inflight.set(item.tenantId, (inflight.get(item.tenantId) ?? 0) + 1)
        MonitorService.probeAndRecord(item.tenantId, item.monitorId).then(
          () => { summary.probed += 1 },
          (err) => { summary.failed += 1; Logger.warn(`[CronJob:${QUEUE_NAME}] probe ${item.tenantId}/${item.monitorId} failed: ${err instanceof Error ? err.message : String(err)}`) },
        ).finally(() => {
          running -= 1
          inflight.set(item.tenantId, (inflight.get(item.tenantId) ?? 1) - 1)
          pump()
        })
      }
      if (running === 0) resolve()
    }
    pump()
  })

  recordSweep({ ...summary, at: now.toISOString(), ms: Date.now() - sweepStarted })
  if (summary.due > 0 || summary.failed > 0) {
    Logger.info(`[CronJob:${QUEUE_NAME}] tenants=${summary.tenants} due=${summary.due} probed=${summary.probed} failed=${summary.failed}${summary.truncated ? ' TRUNCATED' : ''}`)
  }
  if (summary.truncated) {
    // No silent caps: a fleet larger than the ceiling needs the interval or
    // the cap revisited — say so instead of quietly under-probing.
    Logger.warn(`[CronJob:${QUEUE_NAME}] sweep stopped starting probes (budget ${tuning.budgetMs} ms, ceiling ${tuning.maxProbes}); remaining monitors wait for the next tick`)
  }
  return summary
}

export const uptimeProbeQueue = createQueue(QUEUE_NAME, {
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
})

let _worker: Worker | null = null
let _scheduled = false

function startWorker(): Worker {
  if (_worker) return _worker
  _worker = createWorker(QUEUE_NAME, async () => runWithJobContext('uptime-probe', () => cronRun(PLATFORM_CRON_JOBS.probe, () => runProbeSweep())), { concurrency: 1,
  })
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`))
  registerWorkerDrain(_worker)
  return _worker
}

export async function scheduleUptimeProbeJob(cronPattern = '* * * * *'): Promise<void> {
  if (_scheduled) return
  _scheduled = true
  startWorker()
  await uptimeProbeQueue.add('sweep', {}, {
    repeat: { pattern: cronPattern }, jobId: 'observability-uptime-probe-recurring',
  })
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`)
}
