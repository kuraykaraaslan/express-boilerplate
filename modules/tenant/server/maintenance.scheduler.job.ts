import 'reflect-metadata';
import { createQueue, createWorker } from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import MaintenanceService from './maintenance.service';

/**
 * Phase-2 maintenance scheduler: a minutely BullMQ tick that starts due
 * windows, auto-ends overdue ones (the "forgotten maintenance" defence) and
 * sends the one advance notice.
 *
 * The GATE never waits for this. Time-activation happens at resolve time in
 * `resolveMaintenance`, so a dead scheduler delays bookkeeping and
 * notifications — never the 503 and never the lift of a SCHEDULED window.
 * Only a force-started (IN_PROGRESS) window needs the tick to auto-end.
 *
 * Two trigger paths, pick one per deployment (repo convention):
 *  - Self-hosted: `scheduleMaintenanceTickJob()` from instrumentation.ts
 *  - Serverless: POST /api/cron/maintenance-tick with the CRON_SECRET bearer
 */
const QUEUE_NAME = 'tenant-maintenance';

export const maintenanceTickQueue = createQueue(QUEUE_NAME);
let _worker: ReturnType<typeof createWorker> | null = null;
let _scheduled = false;

function startWorker() {
  if (_worker) return _worker;
  _worker = createWorker(QUEUE_NAME, async () => {
    const result = await MaintenanceService.tick();
    if (result.started || result.completed || result.preNotified) {
      Logger.info(`[CronJob:tenant-maintenance] started=${result.started} completed=${result.completed} preNotified=${result.preNotified}`);
    }
    return result;
  }, { concurrency: 1 });
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:tenant-maintenance] Job ${job?.id} failed: ${err.message}`));
  return _worker;
}

export async function scheduleMaintenanceTickJob(cronPattern = '* * * * *'): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();
  await maintenanceTickQueue.add('maintenance-tick', {}, {
    repeat: { pattern: cronPattern }, jobId: 'tenant-maintenance-recurring',
    removeOnComplete: 20, removeOnFail: 50,
  });
  Logger.info(`[CronJob:tenant-maintenance] Scheduled with pattern: ${cronPattern}`);
}
