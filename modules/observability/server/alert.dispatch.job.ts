import 'reflect-metadata'
import type { Worker } from 'bullmq'
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import Logger from '@kuraykaraaslan-labs/logger'
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'
import { sweepTenant } from './alert.dispatch.service'

/**
 * The alert dispatcher's metronome (observability phase 11): once a minute, for every active tenant, release what a silence or a
 * recovered parent was holding back and announce every group whose wait is over. This is what makes `groupWait` / `groupInterval` real and
 * what picks a group up again after a crash (its lease lapses). Self-hosted: scheduled at boot. Serverless: POST /api/cron/alert-dispatch.
 */
const QUEUE_NAME = 'observability-alert-dispatch'

export interface AlertSweepSummary { tenants: number; groups: number; announced: number; failed: number }

async function listActiveTenantIds(): Promise<string[]> {
  try {
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep')
    return (await listActiveTenants()).map((t) => t.tenantId)
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] tenant enumeration unavailable (empty sweep): ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

export async function runAlertSweep(now: Date = new Date()): Promise<AlertSweepSummary> {
  const tenantIds = await listActiveTenantIds()
  const summary: AlertSweepSummary = { tenants: tenantIds.length, groups: 0, announced: 0, failed: 0 }
  for (const tenantId of tenantIds) {
    try {
      const r = await sweepTenant(tenantId, now)
      summary.groups += r.groups
      summary.announced += r.announced
    } catch (err) {
      summary.failed += 1
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (summary.announced > 0 || summary.failed > 0) {
    Logger.info(`[CronJob:${QUEUE_NAME}] tenants=${summary.tenants} groups=${summary.groups} announced=${summary.announced} failed=${summary.failed}`)
  }
  return summary
}

export const alertDispatchQueue = createQueue(QUEUE_NAME, {
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
})

let _worker: Worker | null = null
let _scheduled = false

function startWorker(): Worker {
  if (_worker) return _worker
  _worker = createWorker(QUEUE_NAME, async () => runWithJobContext('alert-dispatch', () => cronRun(PLATFORM_CRON_JOBS.alertDispatch, () => runAlertSweep())), { concurrency: 1 })
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`))
  registerWorkerDrain(_worker)
  return _worker
}

export async function scheduleAlertDispatchJob(cronPattern = '* * * * *'): Promise<void> {
  if (_scheduled) return
  _scheduled = true
  startWorker()
  await alertDispatchQueue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: 'observability-alert-dispatch-recurring' })
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`)
}
