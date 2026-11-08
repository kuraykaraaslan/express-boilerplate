import { Queue, Worker } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { pruneSessions } from './user_session.prune';

/**
 * D28: the session table's housekeeping (user_session.prune.ts). A BullMQ repeat job every 15 minutes, started by the `common:boot_task`
 * contribution in the scheduler phase. Each pass also collapses the same-device leftovers of before the device id (it finds nothing once
 * those rows are gone), so a leftover that was in use at deploy time goes when it has been quiet for a day.
 */
const QUEUE_NAME = 'user-session-prune';

let queue: Queue | null = null;
let worker: Worker | null = null;
let scheduled = false;

export function startSessionPruneWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    QUEUE_NAME,
    async () => pruneSessions(),
    { connection: getBullMQConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  return worker;
}

export async function scheduleSessionPrune(cronPattern = '*/15 * * * *'): Promise<void> {
  if (scheduled) return;
  scheduled = true;
  startSessionPruneWorker();
  queue ??= new Queue(QUEUE_NAME, { connection: getBullMQConnection(), defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } });
  await queue.add('prune', {}, { repeat: { pattern: cronPattern }, jobId: `${QUEUE_NAME}-recurring` });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`);
}
