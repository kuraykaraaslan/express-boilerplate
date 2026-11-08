import { Queue, Worker, Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { processOrder, type OrderRequest } from './tenant_domain.certificates.order';
import { sweepCertificates } from './tenant_domain.certificates.sweep';
import { acmeConfig } from './tenant_domain.acme.config';

/**
 * The certificate queue (phase 51.3): one BullMQ queue, three jobs, one worker.
 *
 *   issue  — order (or renew) the certificate of one domain; jobId `issue-<tenantDomainId>`, so two requests for a name are one order
 *   issue-base — order (or renew) the wildcard of one managed base domain by DNS-01 (phase 56); jobId `issue-base-<baseDomainId>`
 *   probe  — one real TLS handshake to the host, writes the page's ssl* fields from what the world sees (SSLProvisioningService.recheckDomain)
 *   sweep  — twice a day (05:15 and 17:15): puts every domain that needs a certificate on the queue
 *
 * Pace: concurrency 2 and a global limit of one job per 5 s, so a burst (a hundred tenants created at once, a renewal wave) is spread
 * out and the authority's limits (50 new certificates per registered domain a week) are never the first thing to break. Only the worker
 * process starts the consumer (`scheduleCertificateJobs`, a boot task); importing this file never consumes the queue.
 * Job retries are off: the retry schedule of a failed order lives in `tenant_domain_certificates.retryAt` and the sweep.
 */
const QUEUE_NAME = 'tenant-domain-certificates';
export const SWEEP_CRON = '15 5,17 * * *';
export const PACE_MS = 5_000;

export interface DomainJobRef { tenantId: string; tenantDomainId: string; domain: string }

export const certificatesQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: { removeOnComplete: true, removeOnFail: true, attempts: 1 },
});

/** Puts one domain's order on the queue (a no-op while another order for it is waiting or running). `force` skips a back-off. */
export async function enqueueIssue(ref: DomainJobRef, opts: { force?: boolean } = {}): Promise<void> {
  const data: OrderRequest = { ...ref, force: opts.force === true };
  await certificatesQueue.add('issue', data, { jobId: `issue-${ref.tenantDomainId}` });
}

/** Puts one managed base domain's wildcard order on the queue (phase 56); jobId `issue-base-<baseDomainId>`. */
export async function enqueueBaseIssue(baseDomainId: string, opts: { force?: boolean } = {}): Promise<void> {
  await certificatesQueue.add('issue-base', { baseDomainId, force: opts.force === true }, { jobId: `issue-base-${baseDomainId}` });
}

/** A handshake probe of one host, `delayMs` from now. */
export async function enqueueProbe(ref: { tenantId: string; tenantDomainId: string }, delayMs = 0): Promise<void> {
  await certificatesQueue.add('probe', { tenantId: ref.tenantId, tenantDomainId: ref.tenantDomainId }, { delay: delayMs, jobId: `probe-${ref.tenantDomainId}-${Math.floor(Date.now() / 60_000)}` });
}

export async function processJob(job: Pick<Job, 'name' | 'data'>): Promise<unknown> {
  switch (job.name) {
    case 'issue': return processOrder(job.data as OrderRequest);
    case 'issue-base': {
      const { processBaseOrder } = await import('./tenant_domain.base-certificates.order');
      return processBaseOrder(job.data as { baseDomainId: string; force?: boolean });
    }
    case 'probe': {
      const { default: SSLProvisioningService } = await import('./ssl_provisioning.service');
      const { tenantId, tenantDomainId } = job.data as { tenantId: string; tenantDomainId: string };
      const r = await SSLProvisioningService.recheckDomain(tenantId, tenantDomainId);
      return { sslStatus: r.sslStatus };
    }
    case 'sweep': {
      // phase 56: the managed base domains' wildcards first (one order serves every tenant under a base), then the per-name certificates.
      const { sweepBaseCertificates } = await import('./tenant_domain.base-certificates.order');
      const b = await sweepBaseCertificates();
      const r = await sweepCertificates();
      Logger.info(`[CronJob:certificates] wildcards considered=${b.considered} enqueued=${b.enqueued}; considered=${r.considered} enqueued=${r.enqueued} waiting=${r.waiting} fresh=${r.fresh} skipped=${r.skipped} covered=${r.covered} retired=${r.retired}`);
      return { ...r, bases: b };
    }
    default: throw new Error(`certificates queue: unknown job ${job.name}`);
  }
}

let _worker: Worker | null = null;

/** Starts this queue's consumer. Idempotent. */
export function startWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(QUEUE_NAME, (job: Job) => processJob(job), {
    connection: getBullMQConnection(),
    concurrency: 2,
    limiter: { max: 1, duration: PACE_MS },
  });
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:certificates] job ${job?.name}:${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let _scheduled = false;

/** Boot task: starts the worker and registers the twice-daily sweep. Inert (logs once) while ACME_DIRECTORY_URL is unset. */
export async function scheduleCertificateJobs(cronPattern = SWEEP_CRON): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  if (!acmeConfig()) {
    Logger.info('[CronJob:certificates] ACME_DIRECTORY_URL is not set: the platform orders no certificates');
    return;
  }
  startWorker();
  await certificatesQueue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: 'tenant-domain-certificates-sweep-recurring' });
  Logger.info(`[CronJob:certificates] Scheduled with pattern: ${cronPattern}`);
}
