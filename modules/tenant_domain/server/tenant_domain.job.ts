import { Queue, Worker, Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import DNSVerificationService from './dns_verification.service';
import { reconcileAllTenantDomains } from './tenant_domain.reconcile';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Periodic DNS health-check for ACTIVE tenant domains. The original one-shot
 * verification token lives in Redis for 24h — once it expires there is no
 * guarantee the customer's DNS still points at us. This job re-resolves every
 * ACTIVE domain on a cadence and downgrades broken ones to `DNS_FAILED`.
 *
 * It first runs the domain reconcile for every active tenant (tenant_domain.reconcile):
 * every tenant keeps its free subdomain, and custom domains follow the plan
 * (suspended when it stops including them, back when it does). The reconcile is
 * normally triggered by the plan change itself; this sweep is the safety net. It
 * runs first so a domain it brings back to ACTIVE is DNS-checked in the same run.
 *
 * Two trigger paths, pick one per deployment:
 *  - Self-hosted: call `scheduleDnsRecheckJob()` once at app startup
 *  - Serverless: hit POST /tenant/<root>/api/cron/dns-recheck with the
 *    `CRON_SECRET` bearer token
 */
const QUEUE_NAME = 'tenant-domain-dns-recheck';

export const dnsRecheckQueue = new Queue(QUEUE_NAME, {
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
      const reconciled = await reconcileAllTenantDomains();
      const { checked, downgraded } = await DNSVerificationService.recheckActiveDomains();
      // phase 56 (D347): redirects of hosts a tenant left end after 30 days.
      const expiredMoves = await import('./tenant_domain.host-moves').then((m) => m.expireHostMoves()).catch(() => 0);
      if (expiredMoves) Logger.info(`[CronJob:tenant-domain-dns-recheck] host moves expired=${expiredMoves}`);
      Logger.info(`[CronJob:tenant-domain-dns-recheck] checked=${checked} downgraded=${downgraded} suspended=${reconciled.suspended} reactivated=${reconciled.reactivated} reservedSuspended=${reconciled.reservedSuspended}`);
      return { checked, downgraded, reconciled };
    },
    {
      connection: getBullMQConnection(),
      concurrency: 1,
    },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:tenant-domain-dns-recheck] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let _scheduled = false;

export async function scheduleDnsRecheckJob(
  cronPattern = '0 */6 * * *', // default: every 6 hours
): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();

  await dnsRecheckQueue.add(
    'dns-recheck',
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: 'tenant-domain-dns-recheck-recurring',
    },
  );

  Logger.info(`[CronJob:tenant-domain-dns-recheck] Scheduled with pattern: ${cronPattern}`);
}
