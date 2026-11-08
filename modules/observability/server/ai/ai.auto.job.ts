/**
 * The queue behind the delayed automatic investigation (phase 20.2, work order 2 item 3). Self-hosted: `scheduleAiAutoJob()` at boot starts the
 * worker and a once-a-minute sweep (the safety net for a lost delayed job and for a changed delay). Serverless: no worker, so
 * `POST /api/cron/ai-auto` (`cron-ai-auto.route.ts`) runs the same sweep.
 *
 * Idempotency is the job id: `ai-auto__<tenant>__<incident>__<phase>`. BullMQ keeps one job per id (while the job, or its completed record,
 * exists: completed records are kept for a day), so scheduling the same run twice schedules it once; `runAutoInvestigation` then checks the
 * database and takes a Redis claim, so even a duplicate that gets through cannot spend the cap twice.
 */
import 'reflect-metadata';
import { Queue, Worker } from 'bullmq';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import Logger from '@kuraykaraaslan-labs/logger';
import { runWithJobContext } from '@kuraykaraaslan-labs/logger/server/logger.request-context';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { autoJobId, runAutoInvestigation, sweepAutoInvestigations, type AutoJob, type AutoSweepSummary } from './ai.auto';

const QUEUE_NAME = 'observability-ai-auto';

export const aiAutoQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: { removeOnComplete: { age: 86_400, count: 5000 }, removeOnFail: { age: 7 * 86_400, count: 1000 }, attempts: 1 },
});

/** Schedule (or no-op when already scheduled) one run. Resolves true when the job exists in the queue afterwards. */
export async function enqueueAutoInvestigation(job: AutoJob, delayMs: number): Promise<boolean> {
  await aiAutoQueue.add('investigate', job, { jobId: autoJobId(job), delay: Math.max(0, Math.round(delayMs)) });
  return true;
}

async function listActiveTenantIds(): Promise<string[]> {
  try {
    const { listActiveTenants } = await import('@kuraykaraaslan-labs/tenant/server/tenant.sweep');
    return (await listActiveTenants()).map((t) => t.tenantId);
  } catch (err) {
    Logger.warn(`[CronJob:${QUEUE_NAME}] tenant enumeration unavailable (empty sweep): ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

/** One sweep across tenants. Shared by the worker and the cron HTTP twin. */
export async function runAiAutoSweep(): Promise<AutoSweepSummary & { tenants: number }> {
  const tenantIds = await listActiveTenantIds();
  const total = { tenants: tenantIds.length, examined: 0, ran: 0, skipped: 0 };
  for (const tenantId of tenantIds) {
    try {
      const r = await sweepAutoInvestigations(tenantId);
      total.examined += r.examined; total.ran += r.ran; total.skipped += r.skipped;
    } catch (err) {
      Logger.warn(`[CronJob:${QUEUE_NAME}] tenant ${tenantId} sweep failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (total.ran > 0) Logger.info(`[CronJob:${QUEUE_NAME}] tenants=${total.tenants} ran=${total.ran}`);
  return total;
}

let _worker: Worker | null = null;
let _scheduled = false;

function startWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(QUEUE_NAME, async (job) => runWithJobContext('ai-auto', async () => {
    if (job.name === 'sweep') return runAiAutoSweep();
    return runAutoInvestigation(job.data as AutoJob);
  }), { connection: getBullMQConnection(), concurrency: 2 });
  _worker.on('failed', (job, err) => Logger.error(`[CronJob:${QUEUE_NAME}] Job ${job?.id} failed: ${err.message}`));
  registerWorkerDrain(_worker);
  return _worker;
}

export async function scheduleAiAutoJob(cronPattern = '* * * * *'): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();
  await aiAutoQueue.add('sweep', {}, { repeat: { pattern: cronPattern }, jobId: 'observability-ai-auto-sweep-recurring' });
  Logger.info(`[CronJob:${QUEUE_NAME}] Scheduled sweep with pattern: ${cronPattern}`);
}
