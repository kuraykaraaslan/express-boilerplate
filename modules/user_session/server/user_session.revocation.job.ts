import { Queue, Worker, type Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { drainRevocationOutbox } from './user_session.revocation.outbox';
import { fanOutRevoked } from './user_session.revocation';

/**
 * common.29: the worker drain of the session-revocation outbox (user_session.revocation.outbox.ts). A BullMQ repeat job,
 * every minute, started by the `common:boot_task` contribution in the scheduler phase (like auth's dormant sweep). Each run
 * replays the due rows through the same fan-out the revocation used.
 */
const QUEUE_NAME = 'user-session-revocation-outbox';

let queue: Queue | null = null;
let worker: Worker | null = null;
let scheduled = false;

export function startRevocationOutboxWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const out = await drainRevocationOutbox((tenantId, sessions) => fanOutRevoked(tenantId, sessions));
      if (out.done || out.retried || out.dead) Logger.info(`[CronJob:${QUEUE_NAME}] done=${out.done} retried=${out.retried} dead=${out.dead}`);
      return out;
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  return worker;
}

export async function scheduleRevocationOutboxDrain(cronPattern = '* * * * *'): Promise<void> {
  if (scheduled) return;
  scheduled = true;
  startRevocationOutboxWorker();
  queue ??= new Queue(QUEUE_NAME, { connection: getBullMQConnection(), defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 } });
  await queue.add('drain', {}, { repeat: { pattern: cronPattern }, jobId: `${QUEUE_NAME}-recurring` });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled with pattern: ${cronPattern}`);
}
