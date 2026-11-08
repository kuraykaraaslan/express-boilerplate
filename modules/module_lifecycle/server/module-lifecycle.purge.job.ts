import { Queue, Worker, type Job } from 'bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import { purgeExpiredUninstalls } from './module-lifecycle.service';

/**
 * Daily purge of uninstalled modules whose restore window has passed (docs/phases/37-extensions/08). The data stays
 * until then so an uninstall can be undone; after it, the module's rows, its settings and its ledger row go.
 */
const QUEUE_NAME = 'module-lifecycle-purge';

export const moduleLifecyclePurgeQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: { removeOnComplete: 10, removeOnFail: 50 },
});

let worker: Worker | null = null;

/** Starts this queue's consumer; only the schedule function calls it, so importing the file never consumes. Idempotent. */
export function startWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const { purged, failed } = await purgeExpiredUninstalls();
      for (const f of failed) Logger.error(`[CronJob:module-lifecycle-purge] ${f.moduleId} in ${f.tenantId} not purged: ${f.error}`);
      Logger.info(`[CronJob:module-lifecycle-purge] purged=${purged.length} failed=${failed.length}`);
      return { purged: purged.length, failed: failed.length };
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  );
  worker.on('failed', (job, err) => Logger.error(`[CronJob:module-lifecycle-purge] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(worker);
  return worker;
}

let scheduled = false;

export async function scheduleModuleLifecyclePurgeJob(cronPattern = '30 4 * * *'): Promise<void> {
  if (scheduled) return;
  scheduled = true;
  startWorker();
  await moduleLifecyclePurgeQueue.add('purge-expired-uninstalls', {}, { repeat: { pattern: cronPattern }, jobId: 'module-lifecycle-purge-recurring' });
  Logger.info(`[CronJob:module-lifecycle-purge] Scheduled with pattern: ${cronPattern}`);
}
