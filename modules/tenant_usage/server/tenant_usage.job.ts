import { Queue, Worker, Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import { TenantUsageService } from './tenant_usage.service';
import { TenantUsageAlertsService } from './tenant_usage.alerts.service';
import { reconcileTenant, reportUnbilledBacklog } from './tenant_usage.unbilled';
import Logger from '@kuraykaraaslan-labs/logger';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';

/**
 * Hourly flush of every active tenant's Redis usage counters into the
 * `TenantUsage` table. Critical for billing: Redis monthly counters have a
 * 32-day TTL, so without a periodic flush month-end data can be lost. Each
 * tenant's unbilled units (D25, tenant_usage.unbilled.ts) are reconciled first.
 *
 * Two trigger paths:
 *  - Self-hosted: call `scheduleUsageFlushJob()` at boot
 *  - Serverless: hit POST /api/cron/usage-flush on the root tenant with the
 *    `CRON_SECRET` bearer token
 */
const QUEUE_NAME = 'tenant-usage-flush';

export const usageFlushQueue = new Queue(QUEUE_NAME, {
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
      const tenants = await listActiveTenants();
      const now = new Date();
      const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      let flushed = 0;
      let alerts = 0;
      let unbilled = 0;
      for (const t of tenants) {
        try {
          // D25: units admitted while Redis could not count them reach the counters before the counters reach the table
          unbilled += await reconcileTenant(t.tenantId);
          await TenantUsageService.flushToDb(t.tenantId, month);
          flushed += 1;
          // After flushing, evaluate quota alerts/overage (best-effort).
          const res = await TenantUsageAlertsService.evaluateAlerts(t.tenantId).catch(() => null);
          if (res) alerts += res.thresholds + res.overages;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'unknown';
          Logger.warn(`[CronJob:usage-flush] flush failed for ${t.tenantId}: ${message}`);
        }
      }
      reportUnbilledBacklog(unbilled);
      Logger.info(`[CronJob:usage-flush] flushed=${flushed}/${tenants.length} alerts=${alerts} unbilled=${unbilled} month=${month}`);
      return { flushed, total: tenants.length, alerts, unbilled, month };
    },
    { connection: getBullMQConnection(), concurrency: 1 },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:usage-flush] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let _scheduled = false;

export async function scheduleUsageFlushJob(
  cronPattern = '0 * * * *', // default: hourly
): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();

  await usageFlushQueue.add(
    'flush-usage',
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: 'tenant-usage-flush-recurring',
    },
  );

  Logger.info(`[CronJob:usage-flush] Scheduled with pattern: ${cronPattern}`);
}
