import { Queue, Worker } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { sweepPendingDeliveries } from './webhook.pending-sweep';

/**
 * Schedules the pending-delivery sweep (webhook.pending-sweep.ts, D252): every 10 minutes, re-enqueue the PENDING deliveries whose
 * BullMQ job Redis lost. A repeatable job like every other sweep, so the BullMQ repeat keeper (redis.repeat-keeper.ts) adds it again
 * after a Redis that lost its data, the very event this sweep repairs. The HTTP twin is `POST /api/cron/webhook-pending-sweep` for
 * deployments without a worker. Both may run: the sweep holds a lock, and a re-enqueued job's id is the delivery id.
 */
const QUEUE_NAME = 'webhook-pending-sweep';

export const webhookPendingSweepQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: { removeOnComplete: 20, removeOnFail: 50 },
});

let _worker: Worker | null = null;

/** Starts this queue's consumer (from the schedule function only; importing this file never consumes). Idempotent. */
export function startWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(
    QUEUE_NAME,
    async () => {
      const out = await sweepPendingDeliveries();
      Logger.info(`[CronJob:webhook-pending-sweep] candidates=${out.candidates} requeued=${out.requeued} live=${out.live} deadLettered=${out.deadLettered}${out.skipped ? ` skipped=${out.skipped}` : ''}`);
      return out;
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:webhook-pending-sweep] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

export async function scheduleWebhookPendingSweepJob(cronPattern = '*/10 * * * *'): Promise<void> {
  startWorker();
  await webhookPendingSweepQueue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: 'webhook-pending-sweep-recurring' });
  Logger.info(`[CronJob:webhook-pending-sweep] Scheduled: ${cronPattern}`);
}
