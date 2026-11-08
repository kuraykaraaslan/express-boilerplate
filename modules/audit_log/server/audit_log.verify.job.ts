import { Queue, Worker, Job } from 'bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';
import { runWithTenant } from '@kuraykaraaslan-labs/db/server/db.context';
import Logger from '@kuraykaraaslan-labs/logger';
import AuditLogService from './audit_log.service';
import { firstRowPrevHash, latestCheckpointHead, legacyAnchorVerdict, refuseUnanchoredKeyed, verifyChainRange } from './audit_log.query';
import { getRetentionDays } from './audit_log.write.service';
import { AuditActions } from './audit_log.enums';
import { recordVerifyRun } from './audit_log.verify-runs';

/**
 * Weekly integrity sweep: walks every active tenant's audit chain from its first kept row and, for a chain that does not
 * verify, writes one critical `audit.chain_broken` row into that tenant (so the break is itself on the record and shows in
 * the severity filters) and logs it at error level. The row carries the `auditLogId` of the first broken row and the number
 * of rows examined, never row content.
 *
 * A full walk, not a resumed one: a resumed walk would never notice an old row edited after it was verified, which is the
 * attack this job exists for. The verifier pages in keyset batches, so a long chain costs time, not memory.
 *
 * One tenant failing (an unreachable dedicated database, a verifier error) is logged and counted, and never stops the
 * others; an error is not reported as a broken chain, since it proves nothing about the rows.
 */
const QUEUE_NAME = 'audit-chain-verify';

export const auditVerifyQueue = new Queue(QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: {
    removeOnComplete: 10,
    removeOnFail: 50,
  },
});

export interface AuditVerifySweepResult {
  tenants: number;
  /** Rows examined across every tenant that could be verified. */
  checked: number;
  /** Tenants whose chain did not verify. */
  broken: number;
  /** Tenants that could not be verified at all (the verifier threw). */
  errors: number;
}

export async function runAuditVerifySweep(): Promise<AuditVerifySweepResult> {
  const startedAt = new Date();
  const tenants = await listActiveTenants();
  const result: AuditVerifySweepResult = { tenants: tenants.length, checked: 0, broken: 0, errors: 0 };

  for (const tenant of tenants) {
    const { tenantId } = tenant;
    try {
      const verdict = await runWithTenant(tenantId, async () => {
        // A legacy chain with its external anchor is judged exactly as `verifyChain` judges it (audit_log.11): the whole chain from the anchor's base,
        // the anchored head reached after exactly its count of legacy rows, so a truncated trail is broken here too, not only on demand.
        const legacy = await legacyAnchorVerdict(tenantId);
        if (typeof legacy === 'object') return legacy;
        // A purged chain starts at what was kept. A tenant purged through a CHECKPOINT (sealed chains) is checked strictly: the first kept row must link to
        // the head the checkpoint recorded. A tenant with a retention window but no checkpoint (the legacy chain, purged by the JavaScript path) has had its
        // oldest rows deleted on purpose without a record, so the walk forgives the one predecessor the first kept row names. Keep-forever: unanchored.
        const checkpoint = await latestCheckpointHead(tenantId);
        if (checkpoint) return verifyChainRange(tenantId, { anchorHash: checkpoint });
        const anchored = (await getRetentionDays(tenantId)) > 0;
        const range = await verifyChainRange(tenantId, anchored ? { anchorHash: await firstRowPrevHash(tenantId) } : {});
        // No legacy anchor: a keyed chain must have one (every keyed write moves it), so a keyed chain without one lost it.
        return legacy === 'unanchored' ? refuseUnanchoredKeyed(range) : range;
      });
      result.checked += verdict.checked;
      if (verdict.ok) continue;

      result.broken += 1;
      Logger.error(`[CronJob:audit-chain-verify] tenant=${tenantId} chain BROKEN at ${verdict.brokenAt} after ${verdict.checked} rows`);
      try {
        await runWithTenant(tenantId, () => AuditLogService.log({
          tenantId,
          actorType: 'SYSTEM',
          action: AuditActions.CHAIN_BROKEN,
          resourceType: 'audit_chain',
          resourceId: tenantId,
          metadata: { brokenAt: verdict.brokenAt, checked: verdict.checked },
        }));
      } catch (err) {
        // The chain is the thing that is broken: not being able to append to it is an expected outcome.
        Logger.error(`[CronJob:audit-chain-verify] tenant=${tenantId} could not record the break: ${err instanceof Error ? err.message : String(err)}`);
      }
    } catch (err) {
      result.errors += 1;
      Logger.error(`[CronJob:audit-chain-verify] tenant=${tenantId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  // The run is evidence (`audit.chain_ok` reads the newest one); failing to record it never fails the run, and a node whose runs are not recorded
  // cannot answer green, which is the safe side.
  try {
    await recordVerifyRun(result, startedAt, new Date());
  } catch (err) {
    Logger.error(`[CronJob:audit-chain-verify] could not record the run: ${err instanceof Error ? err.message : String(err)}`);
  }
  return result;
}

let _worker: Worker | null = null;

/** Starts this queue's consumer. Only the worker process (or a single process with background jobs on) calls it, from the schedule function; importing this file never consumes the queue. Idempotent. */
export function startWorker(): Worker {
  if (_worker) return _worker;
  _worker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      const result = await runAuditVerifySweep();
      Logger.info(`[CronJob:audit-chain-verify] tenants=${result.tenants} checked=${result.checked} broken=${result.broken} errors=${result.errors}`);
      return result;
    },
    {
      connection: getBullMQConnection(),
      concurrency: 1,
    },
  );
  _worker.on('failed', (job, err) => {
    Logger.error(`[CronJob:audit-chain-verify] Job ${job?.id} failed: ${err.message}`);
  });
  registerWorkerDrain(_worker);
  return _worker;
}

let _scheduled = false;

export async function scheduleAuditVerifyJob(
  cronPattern = '30 3 * * 0', // default: Sundays 03:30, before the daily 04:00 purge
): Promise<void> {
  if (_scheduled) return;
  _scheduled = true;
  startWorker();

  await auditVerifyQueue.add(
    'verify-chain',
    {},
    {
      repeat: { pattern: cronPattern },
      jobId: 'audit-chain-verify-recurring',
    },
  );

  Logger.info(`[CronJob:audit-chain-verify] Scheduled with pattern: ${cronPattern}`);
}
