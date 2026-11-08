import { Queue, Worker, Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import TenantDeletionService from './tenant.deletion.service';
import { expireLegalHolds } from './tenant.legal-hold';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Scheduled hard-purge of tenants whose `deleteAfter` timestamp has elapsed.
 * Soft-deletion is requested via `TenantService.requestDeletion()` which
 * schedules `deleteAfter` 30 days in the future; this job sweeps anything
 * past that horizon and physically removes the row + cascades data cleanup,
 * then deletes the files purged tenants kept under retention once it ends.
 *
 * Two trigger paths, pick one per deployment:
 *  - Self-hosted: call `scheduleTenantPurgeJob()` once at app startup
 *  - Serverless: hit POST /api/cron/purge-expired-tenants on the root tenant
 *    with the `CRON_SECRET` bearer token
 */
const QUEUE_NAME = 'tenant-purge';

export const tenantPurgeQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
  },
});

let _worker: Worker | null = null;

/** Starts this queue's consumer. Only the worker process (or a single process with background jobs on) calls it, from the schedule function; importing this file never consumes the queue. Idempotent. */
export function startWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      // Holds that ran out first: each is reported (LEGAL_HOLD_CLEARED) so the fleet directory's mirror follows (decision F19).
      const holdsExpired = await expireLegalHolds().catch((e: unknown) => { Logger.warn(`[CronJob:tenant-purge] legal hold expiry failed: ${e instanceof Error ? e.message : String(e)}`); return 0; });
      if (holdsExpired) Logger.info(`[CronJob:tenant-purge] legal holds expired=${holdsExpired}`);
      const purged = await TenantDeletionService.purgeExpiredTenants();
      Logger.info(`[CronJob:tenant-purge] purged=${purged}`);
      // Then the files purged tenants still retained, whose retention has ended (never throws).
      const files = await TenantDeletionService.sweepRetainedFiles();
      if (files.tenants) Logger.info(`[CronJob:tenant-purge] retained files: tenants=${files.tenants} deleted=${files.deleted} retained=${files.retained} failed=${files.failed} deferred=${files.deferred}`);
      // Then the purged tenants whose data keys a failed destroy left standing (P7-TDEK crypto-shredding; never throws).
      const keys = await TenantDeletionService.sweepPurgedTenantKeys();
      if (keys.retried) Logger.info(`[CronJob:tenant-purge] data keys: retried=${keys.retried} shredded=${keys.shredded}`);
      return { purged, files, keys };
    },
    {
      connection: getBullMQConnection(),
      concurrency: 1,
    },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:tenant-purge] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let _scheduled = false;

export async function scheduleTenantPurgeJob(
  cronPattern = '0 4 * * *', // default: daily 04:00
): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();

  await tenantPurgeQueue.add(
    'purge-expired-tenants',
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: 'tenant-purge-recurring',
    },
  );

  Logger.info(`[CronJob:tenant-purge] Scheduled with pattern: ${cronPattern}`);
}
