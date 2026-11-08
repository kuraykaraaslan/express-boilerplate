import 'reflect-metadata'
import { Queue, Worker } from 'bullmq'
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import Logger from '@kuraykaraaslan-labs/logger'
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'
import { runReconcileSweep } from './observability.reconcile'

/**
 * The daily metering reconciliation (phase 16.3): compare the meters with the raw tables for the UTC day that ended, store the result, alert the ROOT tenant
 * on a divergence. 02:10 UTC: after midnight so the day is complete, before the 04:30 retention pass so the raw rows are still there.
 *
 *  - Self-hosted: `scheduleReconcileJob()` at boot (a `common:boot_task`).
 *  - Serverless: POST /api/cron/metering-reconcile with the CRON_SECRET bearer.
 * Both run `runReconcileSweep`, and the job reports itself as a heartbeat (`metering-reconcile`), so a reconciliation that stops running is itself an alert.
 */
const QUEUE_NAME = 'observability-reconcile'

export const reconcileQueue = new Queue(QUEUE_NAME, { connection: getBullMQConnection(), defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } })

let _worker: Worker | null = null
let _scheduled = false

function startWorker(): Worker {
  if (_worker) return _worker
  _worker = new Worker(QUEUE_NAME, async () => runWithJobContext('observability-reconcile', () => cronRun(PLATFORM_CRON_JOBS.reconcile, () => runReconcileSweep())), { connection: getBullMQConnection(), concurrency: 1 })
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`))
  registerWorkerDrain(_worker)
  return _worker
}

export async function scheduleReconcileJob(cronPattern = '10 2 * * *'): Promise<void> {
  if (_scheduled) return
  _scheduled = true
  startWorker()
  await reconcileQueue.add('reconcile', {}, { repeat: { pattern: cronPattern }, jobId: 'observability-reconcile-recurring' })
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`)
}
