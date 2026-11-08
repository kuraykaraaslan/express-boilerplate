import 'reflect-metadata'
import type { Worker } from 'bullmq'
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import Logger from '@kuraykaraaslan-labs/logger'
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'
import { runProcessChecks } from './process.checks'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'

/**
 * Expected-process check (docs/phases/09-observability phase 5 §5.2): a kind below its
 * declared `EXPECTED_PROCESSES` count for > 2 heartbeat TTLs opens a ROOT-tenant
 * incident; it auto-resolves when the kind returns. The same tick runs the supervisor crash-loop check
 * (process.scaling.service.ts `evaluateCrashLoops`, 07 task 6). Runs every minute — the
 * 30 s grace is enforced inside the evaluator, the tick is only the metronome.
 *
 *  - Self-hosted: `scheduleProcessCheckJob()` at boot (instrumentation).
 *  - Serverless: POST /api/cron/process-check with the CRON_SECRET bearer.
 */
const QUEUE_NAME = 'observability-process-check'

export const processCheckQueue = createQueue(QUEUE_NAME, {
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
})

let _worker: Worker | null = null
let _scheduled = false

function startWorker(): Worker {
  if (_worker) return _worker
  _worker = createWorker(QUEUE_NAME, async () => runWithJobContext('process-check', () => cronRun(PLATFORM_CRON_JOBS.processCheck, () => runProcessChecks())), { concurrency: 1,
  })
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`))
  registerWorkerDrain(_worker)
  return _worker
}

export async function scheduleProcessCheckJob(cronPattern = '* * * * *'): Promise<void> {
  if (_scheduled) return
  _scheduled = true
  startWorker()
  await processCheckQueue.add('check', {}, {
    repeat: { pattern: cronPattern }, jobId: 'observability-process-check-recurring',
  })
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`)
}
