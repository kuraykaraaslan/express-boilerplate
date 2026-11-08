import 'reflect-metadata'
import type { Worker } from 'bullmq'
import { LessThan } from 'typeorm'
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context'
import { MonitorCheck } from './entities/monitor_check.entity'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'
import { pruneProbeHousekeeping } from './probe.housekeeping'
import CheckDetailService from './uptime.check-detail.service'
import { retentionDaysFor } from './observability.limits'
import { runTenantRetention } from './observability.retention'
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'

/**
 * Raw-check retention pruning (phase 0.4): 100 monitors at 60s is ~144k rows a
 * day, so raw `monitor_checks` are pruned past the per-tenant retention while
 * the DAILY rollup (`monitor_check_daily`) — the source of 7/30/90-day uptime —
 * is kept forever. Pruning therefore never changes a published uptime number.
 * The per-location rollup (`monitor_check_daily_location`, phase 10.5) is exempt in the same way and for the same reason: this sweep deletes from
 * `monitor_checks` only and names neither rollup table, which `uptime.retention.job.test.ts` pins.
 *
 *  - Self-hosted: `scheduleUptimeRetentionJob()` at boot (instrumentation.ts).
 *  - Serverless: POST /api/cron/uptime-retention with the CRON_SECRET bearer.
 */
const QUEUE_NAME = 'observability-uptime-retention'

export const DEFAULT_RETENTION_DAYS = 30
const MIN_RETENTION_DAYS = 2 // 24h uptime reads raw checks — never prune below it
const MAX_RETENTION_DAYS = 365

export interface RetentionSweepSummary {
  tenants: number
  /** Raw checks deleted. */
  pruned: number
  /** The retention tiers (phase 16.4): resolved alerts, resolved incidents, rollups and reconciliation rows deleted, and the workspaces a legal hold protected. */
  alerts: number
  incidents: number
  rollups: number
  reconciliations: number
  held: number
}

/** Per-tenant retention: setting, clamped; fallback 30 days; then capped by the plan (phase 16.2: the plan can shorten it, never lengthen it). */
export async function retentionDays(tenantId: string): Promise<number> {
  return retentionDaysFor(tenantId, await settingRetentionDays(tenantId))
}

async function settingRetentionDays(tenantId: string): Promise<number> {
  try {
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')
    const raw = await SettingService.getValue(tenantId, OBSERVABILITY_SETTING_KEYS.UPTIME_CHECK_RETENTION_DAYS)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    if (Number.isFinite(parsed)) return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, parsed))
  } catch { /* settings unavailable → default */ }
  return DEFAULT_RETENTION_DAYS
}

async function reconcileTelemetry(tenantId: string): Promise<void> {
  try {
    const [{ getTelemetryBackend }, { reconcileRetentionWithPlan }] = await Promise.all([import('./telemetry/telemetry.config'), import('./telemetry/telemetry.lifecycle')])
    await reconcileRetentionWithPlan(getTelemetryBackend(), tenantId)
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} telemetry retention reconcile failed: ${err instanceof Error ? err.message : String(err)}`)
  }
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

/** One full prune across tenants. Shared by the worker and the cron HTTP twin. */
export async function runRetentionSweep(now: Date = new Date()): Promise<RetentionSweepSummary> {
  const tenantIds = await listActiveTenantIds()
  const summary: RetentionSweepSummary = { tenants: tenantIds.length, pruned: 0, alerts: 0, incidents: 0, rollups: 0, reconciliations: 0, held: 0 }
  for (const tenantId of tenantIds) {
    try {
      const days = await retentionDays(tenantId)
      const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000)
      const result = await withTenantRepositoryFor(tenantId, MonitorCheck, (repo) =>
        repo.delete({ tenantId, checkedAt: LessThan(cutoff) }))
      summary.pruned += result.affected ?? 0
      // The tiers beyond raw checks, each bounded by the tenant's setting and the plan (observability.retention.ts); a failure never fails the checks above.
      await runTenantRetention(tenantId, now).then((r) => {
        summary.alerts += r.alerts; summary.incidents += r.incidents; summary.rollups += r.rollups; summary.reconciliations += r.reconciliations
        if (r.held) summary.held += 1
      }, (err) => Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} retention tiers failed: ${err instanceof Error ? err.message : String(err)}`))
      // A downgraded plan must also shorten what the telemetry backend keeps (a no-op without a backend or a stored retention).
      await reconcileTelemetry(tenantId)
      // A browser sample's run record and failure screenshot go with the raw check, on the same cutoff: a picture never outlives the retention the tenant chose.
      await CheckDetailService.prune(tenantId, cutoff).catch((err) => Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} browser detail prune failed: ${err instanceof Error ? err.message : String(err)}`))
      // Leases and enrolment tokens are working state: swept on the same pass, and a failure here never fails the check pruning above.
      await pruneProbeHousekeeping(tenantId, now).catch((err) => Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} probe housekeeping failed: ${err instanceof Error ? err.message : String(err)}`))
    } catch (err) {
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} prune failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  Logger.info(`[CronJob:${QUEUE_NAME}] tenants=${summary.tenants} pruned=${summary.pruned} alerts=${summary.alerts} incidents=${summary.incidents} rollups=${summary.rollups} reconciliations=${summary.reconciliations} held=${summary.held}`)
  return summary
}

export const uptimeRetentionQueue = createQueue(QUEUE_NAME, {
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
})

let _worker: Worker | null = null
let _scheduled = false

function startWorker(): Worker {
  if (_worker) return _worker
  _worker = createWorker(QUEUE_NAME, async () => runWithJobContext('uptime-retention', () => cronRun(PLATFORM_CRON_JOBS.retention, () => runRetentionSweep())), { concurrency: 1,
  })
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`))
  registerWorkerDrain(_worker)
  return _worker
}

export async function scheduleUptimeRetentionJob(cronPattern = '30 4 * * *'): Promise<void> {
  if (_scheduled) return
  _scheduled = true
  startWorker()
  await uptimeRetentionQueue.add('prune', {}, {
    repeat: { pattern: cronPattern }, jobId: 'observability-uptime-retention-recurring',
  })
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`)
}
