import 'reflect-metadata'
import type { Worker } from 'bullmq'
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import Logger from '@kuraykaraaslan-labs/logger'
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'
import { pushWatchdog } from './watchdog'
import { currentWatchdogSignal } from './watchdog.signal'

/**
 * The watchdog's metronome (observability phase 19.5): once a minute, "I am alive" goes to the outside party. The job runs on the same scheduler as everything
 * else on purpose: if the scheduler or Redis is dead, the pushes stop, and that silence IS the signal.
 */
const QUEUE_NAME = 'observability-watchdog'

export const watchdogQueue = createQueue(QUEUE_NAME, {
  defaultJobOptions: { removeOnComplete: 5, removeOnFail: 20 } })

let _worker: Worker | null = null
let _scheduled = false

function startWorker(): Worker {
  if (_worker) return _worker
  _worker = createWorker(QUEUE_NAME, async () => runWithJobContext('watchdog', async () => pushWatchdog((await currentWatchdogSignal()).signal)), { concurrency: 1 })
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`))
  registerWorkerDrain(_worker)
  return _worker
}

export async function scheduleWatchdogJob(cronPattern = '* * * * *'): Promise<void> {
  if (_scheduled) return
  _scheduled = true
  startWorker()
  await watchdogQueue.add('push', {}, { repeat: { pattern: cronPattern }, jobId: 'observability-watchdog-recurring' })
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`)
}
