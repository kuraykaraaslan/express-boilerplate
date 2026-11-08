import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { In } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import Logger from '@kuraykaraaslan-labs/logger';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import { WebhookDelivery as WebhookDeliveryEntity } from './entities/webhook_delivery.entity';
import { resolveDeliveryConfig, toWebhookJobData, type WebhookJobData } from './webhook.config';
import { webhookQueue } from './webhook.queue';
import { WEBHOOK_ENDPOINT_GONE } from './webhook.job-resolve';

/**
 * Re-enqueues webhook deliveries whose BullMQ job was lost (docs/audits/2026-11-03-redis-outage.md §6.4 / §6.8, D252).
 *
 * A delivery is a `webhook_deliveries` row (PENDING) plus a job in `webhookDeliveryQueue`. A Redis that lost its data lost the job, and
 * the row stayed PENDING for ever: nothing else ever looks at it (webhook.11 covers only a hand-off that FAILED, which marks the row).
 * This sweep finds those rows and gives each a job again. Rules, in order (`sweepPendingDeliveries`):
 *
 * 1. **Candidates**: PENDING rows whose next attempt was due more than `STALE_AFTER_MS` ago (`nextRetryAt`, or the row's last write for a
 *    first attempt), oldest first, at most `PER_TENANT_MAX` per tenant and `MAX_PER_RUN` per run, each tenant read in its own context.
 *    SUCCESS, FAILED and DEAD_LETTERED rows are never read, and each write below is conditional on the row still being PENDING.
 * 2. **No live job**: the ids of every live job of the queue (waiting, delayed, active, prioritized, paused) are read first; a candidate
 *    with a live job is left alone (a long backoff, a backlog). More than `LIVE_SCAN_MAX` live jobs: the run does nothing (the worker is
 *    behind and absence cannot be proven cheaply); the next run asks again. A job the sweep added earlier has the delivery id as its id:
 *    a live one is left alone, a finished one (kept 7 / 14 days) is removed first, because BullMQ would otherwise treat the new add as a
 *    duplicate of it and the row would stay stuck.
 * 3. **Too old**: a row created more than `MAX_AGE_MS` ago is not re-sent automatically (an event a day late surprises a receiver more
 *    than it helps): it is dead-lettered with a reason, and the dead-letter replay sends it when someone decides to.
 * 4. **Endpoint**: a deleted endpoint dead-letters the row (`WEBHOOK_ENDPOINT_GONE`, as the worker does); a disabled one dead-letters it
 *    with a reason too (webhook.02: a disabled endpoint receives nothing; replay after enabling it).
 * 5. **Re-enqueue** with `jobId` = the delivery id, so two sweeps (the repeat job and its HTTP twin, or two runs) add one job. The job is
 *    exactly what a manual redeliver queues (ids and the stored body, `toWebhookJobData`), so the receiver sees the same headers: the same
 *    `X-Webhook-Delivery` (its dedupe key), a fresh signature over the same bytes. The row keeps its attempt count: the job may run
 *    `maxAttempts - attempts` times (at least once) and the row still decides when it is dead.
 *
 * At-least-once: a job lost after its HTTP call but before its row was written is sent again; the receiver deduplicates on
 * `X-Webhook-Delivery`. One run at a time (a Redis lock); Redis down: the run fails and the next one tries.
 */

export const STALE_AFTER_MS = 15 * 60_000;
export const MAX_AGE_MS = 24 * 60 * 60_000;
export const MAX_PER_RUN = 200;
export const PER_TENANT_MAX = 50;
export const LIVE_SCAN_MAX = 5_000;
const LIVE_PAGE = 500;
export const SWEEP_LOCK_KEY = 'webhook:pending-sweep:lock';
const SWEEP_LOCK_SECONDS = 300;
const LIVE_STATES = ['waiting', 'delayed', 'active', 'prioritized', 'paused', 'waiting-children'] as const;

export const LOST_TOO_OLD = 'The delivery job was lost and the event is more than a day old: not re-sent automatically (replay it from the dead letters).';
export const LOST_ENDPOINT_DISABLED = 'The delivery job was lost while the endpoint is disabled: not re-sent (enable the endpoint, then replay the dead letters).';

export interface SweepResult {
  candidates: number;
  requeued: number;
  live: number;
  deadLettered: number;
  /** The run did nothing: another sweep held the lock, or too many live jobs to prove absence. */
  skipped?: 'locked' | 'live-scan-cap';
}

interface Candidate {
  deliveryId: string; tenantId: string; webhookId: string; event: string; requestBody: string;
  attempts: number; maxAttempts: number; createdAt: Date;
  /** The row's current claim (41-ui-fixes/12 1.5): the lost job carried it, so its replacement must too, or the worker refuses it. */
  claimId: string | null;
}

/** The queue calls the sweep makes (the shared producer handle in production). */
export interface SweepQueue {
  getJobCounts(...types: string[]): Promise<Record<string, number>>;
  getJobs(types: string[], start?: number, end?: number): Promise<Array<{ id?: string; data?: Partial<WebhookJobData> } | undefined>>;
  getJob(id: string): Promise<{ getState(): Promise<string>; remove(): Promise<void> } | undefined | null>;
  add(name: string, data: WebhookJobData, opts: Record<string, unknown>): Promise<unknown>;
}

export interface SweepDeps {
  queue: SweepQueue;
  listTenants: () => Promise<string[]>;
  lock: { acquire(token: string): Promise<boolean>; release(token: string): Promise<void> };
  now?: () => number;
}

const defaultDeps = (): SweepDeps => ({
  queue: webhookQueue as unknown as SweepQueue,
  listTenants: async () => (await listActiveTenants()).map((t) => t.tenantId),
  lock: {
    acquire: async (token) => (await redis.set(SWEEP_LOCK_KEY, token, 'EX', SWEEP_LOCK_SECONDS, 'NX')) === 'OK',
    release: async (token) => { if ((await redis.get(SWEEP_LOCK_KEY)) === token) await redis.del(SWEEP_LOCK_KEY); },
  },
});

/** Rule 1: one tenant's overdue PENDING rows, oldest first, in its own context. */
async function overdue(tenantId: string, cutoff: Date, take: number): Promise<Candidate[]> {
  const rows = await withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, (repo) => repo.createQueryBuilder('d')
    .select(['d.deliveryId', 'd.tenantId', 'd.webhookId', 'd.event', 'd.requestBody', 'd.attempts', 'd.maxAttempts', 'd.createdAt', 'd.claimId'])
    .where('d.tenantId = :tenantId AND d.status = :status', { tenantId, status: 'PENDING' })
    .andWhere('COALESCE(d.nextRetryAt, d.updatedAt) < :cutoff', { cutoff })
    .orderBy('d.createdAt', 'ASC')
    .take(take)
    .getMany());
  return (rows as unknown as Candidate[]).filter((r) => r.tenantId === tenantId);
}

/** Rule 2: the delivery ids of every live job, or null when there are more than `LIVE_SCAN_MAX`. */
async function liveDeliveryIds(queue: SweepQueue): Promise<Set<string> | null> {
  const counts = await queue.getJobCounts(...LIVE_STATES);
  const total = Object.values(counts).reduce((a, b) => a + (Number(b) || 0), 0);
  if (total > LIVE_SCAN_MAX) return null;
  const ids = new Set<string>();
  for (let start = 0; start < total; start += LIVE_PAGE) {
    for (const job of await queue.getJobs([...LIVE_STATES], start, start + LIVE_PAGE - 1)) {
      if (job?.data?.deliveryId) ids.add(job.data.deliveryId);
      if (job?.id) ids.add(String(job.id));
    }
  }
  return ids;
}

/** Marks a still-PENDING row dead-lettered with a reason. Resolves with whether it was (a row that moved on meanwhile is left). */
async function deadLetter(c: Candidate, reason: string): Promise<boolean> {
  const res = await withTenantRepositoryFor(c.tenantId, WebhookDeliveryEntity, (repo) => repo.update(
    { deliveryId: c.deliveryId, tenantId: c.tenantId, status: 'PENDING' },
    { status: 'DEAD_LETTERED', nextRetryAt: null, errorMessage: reason } as never,
  ));
  return Number((res as { affected?: number } | undefined)?.affected ?? 0) > 0;
}

/**
 * Rule 5: the job a manual redeliver queues (ids and the stored body), under the delivery id. A finished job of that id from an earlier
 * sweep is removed first; a live one means there is nothing to do.
 */
async function requeue(queue: SweepQueue, c: Candidate, backoffMs: number): Promise<'requeued' | 'live'> {
  const existing = await queue.getJob(c.deliveryId);
  if (existing) {
    const state = await existing.getState();
    if ((LIVE_STATES as readonly string[]).includes(state)) return 'live';
    await existing.remove();
  }
  await queue.add(
    'redeliver',
    // the row's own claim: the job resolver sends only a job of the row's current claim (jobMatchesClaim), and a PENDING row the sweep
    // found is still under the claim its lost job had, so no new claim is taken (that would need the row written again)
    toWebhookJobData({ deliveryId: c.deliveryId, tenantId: c.tenantId, webhookId: c.webhookId, event: c.event, requestBody: c.requestBody, ...(c.claimId ? { claimId: c.claimId } : {}) }),
    { jobId: c.deliveryId, attempts: Math.max(1, (c.maxAttempts ?? 1) - (c.attempts ?? 0)), backoff: { type: 'exponential', delay: backoffMs } },
  );
  return 'requeued';
}

export async function sweepPendingDeliveries(depsIn?: Partial<SweepDeps>): Promise<SweepResult> {
  const deps = { ...defaultDeps(), ...depsIn };
  const now = (deps.now ?? Date.now)();
  const result: SweepResult = { candidates: 0, requeued: 0, live: 0, deadLettered: 0 };
  const token = randomBytes(8).toString('hex');
  if (!(await deps.lock.acquire(token))) return { ...result, skipped: 'locked' };
  try {
    const cutoff = new Date(now - STALE_AFTER_MS);
    const candidates: Candidate[] = [];
    for (const tenantId of await deps.listTenants()) {
      if (candidates.length >= MAX_PER_RUN) break;
      try {
        candidates.push(...await overdue(tenantId, cutoff, Math.min(PER_TENANT_MAX, MAX_PER_RUN - candidates.length)));
      } catch (err) {
        Logger.warn(`[Webhook] pending sweep could not read tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    result.candidates = candidates.length;
    if (candidates.length === 0) return result; // the common case: no queue scan at all

    const live = await liveDeliveryIds(deps.queue);
    if (!live) {
      Logger.warn(`[Webhook] pending sweep skipped: more than ${LIVE_SCAN_MAX} live delivery jobs, absence of a job cannot be proven`);
      return { ...result, skipped: 'live-scan-cap' };
    }

    const byTenant = new Map<string, Candidate[]>();
    for (const c of candidates) byTenant.set(c.tenantId, [...(byTenant.get(c.tenantId) ?? []), c]);
    for (const [tenantId, rows] of byTenant) {
      const ids = [...new Set(rows.map((r) => r.webhookId))];
      const endpoints = new Map((await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) =>
        repo.find({ where: { tenantId, webhookId: In(ids) }, select: { webhookId: true, tenantId: true, isActive: true } })))
        .filter((w) => w.tenantId === tenantId)
        .map((w) => [w.webhookId, w]));
      const { retryDelaysMs } = await resolveDeliveryConfig(tenantId);
      for (const c of rows) {
        try {
          if (live.has(c.deliveryId)) { result.live++; continue; }
          const endpoint = endpoints.get(c.webhookId);
          const reason = now - new Date(c.createdAt).getTime() > MAX_AGE_MS ? LOST_TOO_OLD
            : !endpoint ? WEBHOOK_ENDPOINT_GONE
              : endpoint.isActive === false ? LOST_ENDPOINT_DISABLED : null;
          if (reason) { if (await deadLetter(c, reason)) result.deadLettered++; continue; }
          if ((await requeue(deps.queue, c, retryDelaysMs[0] ?? 60_000)) === 'live') result.live++;
          else result.requeued++;
        } catch (err) {
          Logger.warn(`[Webhook] pending sweep could not re-enqueue delivery ${c.deliveryId}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
    if (result.requeued || result.deadLettered) {
      Logger.warn(`[Webhook] pending sweep: ${result.requeued} deliveries without a job re-enqueued, ${result.deadLettered} dead-lettered`);
    }
    return result;
  } finally {
    await deps.lock.release(token).catch(() => undefined);
  }
}
