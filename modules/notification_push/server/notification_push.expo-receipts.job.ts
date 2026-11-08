import { Queue, Worker } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { settleReceipts } from './notification_push.expo-receipts';

/**
 * Scheduled sweep that reads Expo push receipts and prunes dead tokens.
 *
 * Two trigger paths, pick one per deployment:
 *  - Self-hosted: `scheduleExpoReceiptsJob()` once at startup (registered in instrumentation)
 *  - Serverless: POST /api/cron/expo-receipts on the root tenant with the CRON_SECRET bearer
 */
const QUEUE_NAME = 'push-expo-receipts';

export const expoReceiptsQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
});

let _worker: Worker | null = null;

/** Starts this queue's consumer. Only the worker process (or a single process with background jobs on) calls it, from the schedule function; importing this file never consumes the queue. Idempotent. */
export function startWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(
    QUEUE_NAME,
    async () => {
      const result = await settleReceipts();
      Logger.info(`[CronJob:push-expo-receipts] ${JSON.stringify(result)}`);
      return result;
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:push-expo-receipts] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let scheduled = false;

export async function scheduleExpoReceiptsJob(cronPattern = '*/15 * * * *'): Promise<void> {
  if (scheduled) return;
  scheduled = true;
  startWorker();
  await expoReceiptsQueue.add('settle', {}, { repeat: { pattern: cronPattern }, jobId: 'push-expo-receipts-recurring' });
  Logger.info(`[CronJob:push-expo-receipts] Scheduled with pattern: ${cronPattern}`);
}
