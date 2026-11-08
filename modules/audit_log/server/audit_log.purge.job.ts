import { Queue, Worker, Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import { runAuditPurgeSweep } from './audit_log.purge.sweep';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Automated retention purge sweep. For every tenant, runs
 * AuditLogService.purgeExpired — which is a no-op for tenants whose
 * `auditLogRetentionDays` is 0 (keep forever). Tenants with a configured
 * retention window have rows older than the window hard-deleted.
 *
 * Two trigger paths, pick one per deployment:
 *  - Self-hosted: call `scheduleAuditPurgeJob()` once at app startup.
 *  - Serverless: invoke `runAuditPurgeSweep()` from a cron route guarded by
 *    the platform CRON_SECRET (mirrors auth.dormant.job).
 *
 * The body lives in `audit_log.purge.sweep.ts` (no queue), so the cron route
 * runs exactly the same code. Sealed tenants are archived before deletion when
 * an archive destination is contributed (see that file).
 */
const QUEUE_NAME = 'audit-log-purge';

export const auditPurgeQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
  },
});

export { runAuditPurgeSweep };

let _worker: Worker | null = null;

/** Starts this queue's consumer. Only the worker process (or a single process with background jobs on) calls it, from the schedule function; importing this file never consumes the queue. Idempotent. */
export function startWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const result = await runAuditPurgeSweep();
      Logger.info(`[CronJob:audit-log-purge] tenants=${result.tenants} purged=${result.purged} archived=${result.archived} errors=${result.errors}`);
      return result;
    },
    {
      connection: getBullMQConnection(),
      concurrency: 1,
    },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:audit-log-purge] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let _scheduled = false;

export async function scheduleAuditPurgeJob(
  cronPattern = '0 4 * * *', // default: daily 04:00
): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();

  await auditPurgeQueue.add(
    'purge-expired',
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: 'audit-log-purge-recurring',
    },
  );

  Logger.info(`[CronJob:audit-log-purge] Scheduled with pattern: ${cronPattern}`);
}
