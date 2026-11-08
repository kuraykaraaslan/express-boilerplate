import { Queue, Worker, Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import SSLProvisioningService from './ssl_provisioning.service';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Daily TLS handshake probe across every tenant custom domain — keeps the
 * `sslStatus / sslIssuedAt / sslExpiresAt / sslIssuer / sslLastCheckedAt`
 * fields on `TenantDomain` in sync with reality. Without this the admin
 * sees stale "ACTIVE" labels even after a Let's Encrypt renewal fails.
 *
 * Two trigger paths:
 *  - Self-hosted: call `scheduleSslHealthJob()` at boot
 *  - Serverless: hit POST /api/cron/ssl-health on the root tenant with the
 *    `CRON_SECRET` bearer token
 */
const QUEUE_NAME = 'tenant-domain-ssl-health';

export const sslHealthQueue = new Queue(QUEUE_NAME, {
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
      const { checked, activated, expiring, failed } = await SSLProvisioningService.recheckCertificates();
      Logger.info(
        `[CronJob:ssl-health] checked=${checked} active=${activated} expiring=${expiring} failed=${failed}`,
      );
      return { checked, activated, expiring, failed };
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:ssl-health] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let _scheduled = false;

export async function scheduleSslHealthJob(
  cronPattern = '15 5 * * *', // default: daily 05:15 — staggered from other 03:00 / 04:00 jobs
): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();

  await sslHealthQueue.add(
    'ssl-health',
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: 'tenant-domain-ssl-health-recurring',
    },
  );

  Logger.info(`[CronJob:ssl-health] Scheduled with pattern: ${cronPattern}`);
}
