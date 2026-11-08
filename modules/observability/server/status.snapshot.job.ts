import 'reflect-metadata'
import type { Worker } from 'bullmq'
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import Logger from '@kuraykaraaslan-labs/logger'
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'
import { onStatusChanged } from './status.realtime'
import StatusSnapshotService from './status.snapshot.service'
import StatusPageService from './status.page.service'
import { syncHostBindings } from './status.host'

/**
 * The snapshot heartbeat and the state-change trigger (observability phase 15.9).
 *
 *  - Heartbeat: every five minutes, every tenant's snapshots are refreshed (or retracted, when a page stopped being public). This is what
 *    keeps "last updated" honest and the staleness bound meaningful, and what retracts a snapshot after a setting changed behind our back.
 *    Self-hosted: `scheduleStatusSnapshotJob()` at boot. Serverless: POST /api/cron/status-snapshot with the CRON_SECRET bearer.
 *  - State change: in a process that runs the boot task, every status change of a tenant schedules a refresh a few seconds later (one per
 *    tenant, so a burst of changes writes once). Without the boot task (a serverless deployment) the heartbeat alone applies.
 */
const QUEUE_NAME = 'observability-status-snapshot'
const DEBOUNCE_MS = 3000

export interface SnapshotSweepSummary { tenants: number; published: number; unchanged: number; failed: number; retracted: number }

async function listActiveTenantIds(): Promise<string[]> {
  try {
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep')
    return (await listActiveTenants()).map((t) => t.tenantId)
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] tenant enumeration unavailable (empty sweep): ${err instanceof Error ? err.message : String(err)}`)
    return []
  }
}

/** One full heartbeat across tenants. Shared by the worker and the cron HTTP twin. A failing tenant never stops the rest. */
export async function runSnapshotSweep(): Promise<SnapshotSweepSummary> {
  const tenantIds = await listActiveTenantIds()
  const summary: SnapshotSweepSummary = { tenants: tenantIds.length, published: 0, unchanged: 0, failed: 0, retracted: 0 }
  for (const tenantId of tenantIds) {
    try {
      // The proxy's mirror of host bindings rides the same beat (see status.host.ts): a lost key is back within one run.
      await syncHostBindings(tenantId, await StatusPageService.listRows(tenantId))
      for (const r of await StatusSnapshotService.publishTenant(tenantId)) {
        if (r.state === 'published') summary.published++
        else if (r.state === 'unchanged') summary.unchanged++
        else if (r.state === 'failed') summary.failed++
        else if (r.state === 'disabled') summary.retracted++
      }
    } catch (err) {
      summary.failed++
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  Logger.info(`[CronJob:${QUEUE_NAME}] tenants=${summary.tenants} published=${summary.published} unchanged=${summary.unchanged} failed=${summary.failed} retracted=${summary.retracted}`)
  return summary
}

/** A debouncer keyed by tenant: the last call inside the window wins, one run per window. Exported for the test. */
export function makeDebouncer(run: (tenantId: string) => void, delayMs = DEBOUNCE_MS): (tenantId: string) => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  return (tenantId) => {
    const existing = timers.get(tenantId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => { timers.delete(tenantId); run(tenantId) }, delayMs)
    timer.unref?.()
    timers.set(tenantId, timer)
  }
}

export const statusSnapshotQueue = createQueue(QUEUE_NAME, {
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
})

let _worker: Worker | null = null
let _scheduled = false

function startWorker(): Worker {
  if (_worker) return _worker
  _worker = createWorker(QUEUE_NAME, async () => runWithJobContext('status-snapshot', () => runSnapshotSweep()), { concurrency: 1 })
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`))
  registerWorkerDrain(_worker)
  return _worker
}

export async function scheduleStatusSnapshotJob(cronPattern = '*/5 * * * *'): Promise<void> {
  if (_scheduled) return
  _scheduled = true
  startWorker()
  await statusSnapshotQueue.add('heartbeat', {}, { repeat: { pattern: cronPattern }, jobId: 'observability-status-snapshot-recurring' })
  // State changes refresh the snapshot of that tenant a few seconds later; failures are the heartbeat's to repair.
  onStatusChanged(makeDebouncer((tenantId) => {
    void StatusSnapshotService.publishTenant(tenantId).catch((err) => Logger.warn(`[observability] status snapshot on change failed: ${err instanceof Error ? err.message : String(err)}`))
  }))
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`)
}
