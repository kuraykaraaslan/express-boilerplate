import { Queue, Worker } from 'bullmq'
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq'
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks'
import Logger from '@kuraykaraaslan-labs/logger'
import { sweepStagingUploads } from './storage.direct-upload'

/**
 * Deletes the staging objects of browser-direct uploads that were presigned but
 * never completed (and staging keys a client re-PUT after complete). The index
 * lives in Redis (`storage.direct-upload.store.ts`), so a run is cheap when there
 * is nothing to do. Without background jobs nothing sweeps them; see the storage
 * README for the bucket lifecycle rule that backs this up.
 */
const QUEUE_NAME = 'storage-upload-sweep'

export const uploadSweepQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
})

let _worker: Worker | null = null

/** Starts this queue's consumer. Only called from the schedule function; importing this file never consumes the queue. Idempotent. */
export function startUploadSweepWorker(): Worker {
  if (_worker) return _worker
  _worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await sweepStagingUploads()
      if (result.deleted || result.failed) Logger.info(`[CronJob:storage-upload-sweep] deleted=${result.deleted} failed=${result.failed}`)
      return result
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  )
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:storage-upload-sweep] Job ${job?.id} failed: ${err.message}`)
  })
  registerWorkerDrain(_worker)
  return _worker
}

/** Register the repeatable sweep (every 30 minutes). Called at boot through the module's `common:boot_task`. */
export async function scheduleUploadSweepJob(cronPattern = '*/30 * * * *'): Promise<void> {
  startUploadSweepWorker()
  await uploadSweepQueue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: 'storage-upload-sweep-recurring' })
  Logger.info(`[CronJob:storage-upload-sweep] Scheduled with pattern: ${cronPattern}`)
}
