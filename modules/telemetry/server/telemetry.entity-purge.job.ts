import Logger from '@kuraykaraaslan-labs/logger';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { ensureTelemetryKindsLoaded, laneOf, telemetryKindOf } from './telemetry.kinds';
import { purgeEntityWindowed, type WindowedPurgeReport } from './telemetry.tenant-purge';

/**
 * `telemetry-entity-purge`: the readings of one deleted entity (a device) leave through a queue, one job at a time.
 *
 * An owner that deletes an entity calls `enqueueEntityPurge` after its own delete committed; the request is never held by the purge.
 * The queue is a BullMQ queue on the shared Redis and its worker runs with concurrency 1 in the platform's scheduler, so big purges
 * go one after the other and never compete with each other or with the writer for the disk. A job deletes the entity's raw and
 * minute rows in time windows (`purgeEntityTelemetryWindowed`), then its rollups and latest rows. A failed job is retried with a
 * back-off (the purge is idempotent); the job id is the entity, so enqueueing the same entity twice leaves one job.
 *
 * Reads never wait for the purge: the owner's `canRead` already refuses a deleted entity.
 */
export const ENTITY_PURGE_QUEUE = 'telemetry-entity-purge';
export const ENTITY_PURGE_ATTEMPTS = 5;
export const ENTITY_PURGE_BACKOFF_MS = 30_000;

export interface EntityPurgeJob {
  tenantId: string;
  kind: string;
  entityId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KIND = /^[a-z][a-z0-9_]{0,63}$/;

/** A malformed job is a programming error, refused where it is enqueued and again where it is run (a hand-written queue entry). */
export function entityPurgeProblem(j: Partial<EntityPurgeJob> | null | undefined): string | null {
  if (!j || typeof j !== 'object') return 'no job';
  if (typeof j.tenantId !== 'string' || !UUID.test(j.tenantId)) return 'tenantId is not a uuid';
  if (typeof j.entityId !== 'string' || !UUID.test(j.entityId)) return 'entityId is not a uuid';
  if (typeof j.kind !== 'string' || !KIND.test(j.kind)) return 'kind is not a kind name';
  return null;
}

/** BullMQ refuses ':' in a custom id; the three parts are validated, so '_' cannot make two entities collide. */
export const entityPurgeJobId = (j: EntityPurgeJob): string => `purge_${j.kind}_${j.tenantId}_${j.entityId}`;

type PurgeQueue = { add: (name: string, data: EntityPurgeJob, opts: Record<string, unknown>) => Promise<unknown> };
let queue: PurgeQueue | null = null;

async function getQueue(): Promise<PurgeQueue> {
  if (!queue) {
    const { createQueue } = await import('@kuraykaraaslan-labs/redis/server/redis.bullmq');
    queue = createQueue<EntityPurgeJob>(ENTITY_PURGE_QUEUE, {
      defaultJobOptions: {
        attempts: ENTITY_PURGE_ATTEMPTS,
        backoff: { type: 'exponential', delay: ENTITY_PURGE_BACKOFF_MS },
        removeOnComplete: true,
        removeOnFail: 500,
      },
    }) as unknown as PurgeQueue;
  }
  return queue;
}

/**
 * Queues the purge of one entity's readings. Call it after the entity's delete committed. Resolves once the job is in Redis; a Redis
 * outage throws, so the caller decides whether to log it (the readings then age out with their retention class, they never leak).
 */
export async function enqueueEntityPurge(job: EntityPurgeJob, q?: PurgeQueue): Promise<void> {
  const problem = entityPurgeProblem(job);
  if (problem) throw new Error(`[telemetry] entity purge not queued: ${problem}`);
  await (q ?? (await getQueue())).add('purge', { tenantId: job.tenantId, kind: job.kind, entityId: job.entityId }, { jobId: entityPurgeJobId(job) });
}

export interface EntityPurgeDeps {
  loadKinds: () => Promise<void>;
  laneOfKind: (kind: string) => string | null;
  purge: (tenantId: string, lane: string, entityId: string) => Promise<WindowedPurgeReport>;
  log?: (text: string) => void;
}

const defaultDeps = (): EntityPurgeDeps => ({
  loadKinds: ensureTelemetryKindsLoaded,
  laneOfKind: (kind) => {
    const k = telemetryKindOf(kind);
    return k ? laneOf(k) : null;
  },
  purge: (tenantId, lane, entityId) => purgeEntityWindowed(tenantId, lane, entityId),
  log: (text) => Logger.info(text),
});

/**
 * One job. A kind that is not registered (its module is off or gone) is not guessed into a lane, because the lane names the tables:
 * the job fails and is retried with its back-off, and after the attempts it stays in the failed set for an operator.
 */
export async function runEntityPurge(job: EntityPurgeJob, deps: EntityPurgeDeps = defaultDeps()): Promise<WindowedPurgeReport> {
  const problem = entityPurgeProblem(job);
  if (problem) throw new Error(`[telemetry] entity purge refused: ${problem}`);
  await deps.loadKinds();
  const lane = deps.laneOfKind(job.kind);
  if (!lane) throw new Error(`[telemetry] entity purge: kind "${job.kind}" is not registered`);
  const started = Date.now();
  const report = await deps.purge(job.tenantId, lane, job.entityId);
  deps.log?.(`[CronJob:${ENTITY_PURGE_QUEUE}] ${job.kind} ${job.entityId} of ${job.tenantId}: ${report.statements} statements on ${report.tables} tables in ${Date.now() - started} ms`);
  return report;
}

let started = false;

/** The boot task (`module.json`, `common:boot_task`, phase `scheduler`): the worker, one job at a time. */
export async function scheduleTelemetryEntityPurgeWorker(): Promise<void> {
  if (started) return;
  started = true;
  const { createWorker } = await import('@kuraykaraaslan-labs/redis/server/redis.bullmq');
  const worker = createWorker<EntityPurgeJob>(ENTITY_PURGE_QUEUE, async (job) => runEntityPurge(job.data), { concurrency: 1 });
  worker.on('failed', (job, err) => Logger.error(`[CronJob:${ENTITY_PURGE_QUEUE}] Job ${job?.id} failed (attempt ${job?.attemptsMade ?? '?'}/${ENTITY_PURGE_ATTEMPTS}): ${err.message}`));
  registerWorkerDrain(worker);
  Logger.info(`[CronJob:${ENTITY_PURGE_QUEUE}] Worker started (concurrency 1)`);
}
