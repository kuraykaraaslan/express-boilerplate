import 'reflect-metadata';
import { Queue, Worker, Job } from 'bullmq';
import { getBullMQConnection } from '@kuraykaraaslan-labs/redis/server/redis.bullmq';
import { registerWorkerDrain } from '@kuraykaraaslan-labs/common/server/process-hooks';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import { WebhookDelivery as WebhookDeliveryEntity } from './entities/webhook_delivery.entity';
import type { WebhookEvent } from './webhook.enums';
import Logger from '@kuraykaraaslan-labs/logger';
import { checkWebhookRateLimit } from '@kuraykaraaslan-labs/limiter/server/limiter.tenant-plan.service';
import { resolveDeliveryConfig, toWebhookJobData, webhookBackoffStrategy, WEBHOOK_BACKOFF_TYPE, type WebhookJobData } from './webhook.config';
import WebhookDeliveryService from './webhook.delivery.service';
import { createHash, randomUUID } from 'node:crypto';
import { buildEnvelope, type WebhookFormat } from './webhook.envelope';
import { resolveDeliveryJob } from './webhook.job-resolve';

export { resolveDeliveryJob, previousSecretInWindow, WEBHOOK_ENDPOINT_GONE, WEBHOOK_ENDPOINT_DISABLED } from './webhook.job-resolve';

export const WEBHOOK_QUEUE_NAME = 'webhookDeliveryQueue';

const DAY_SECONDS = 24 * 60 * 60;

/**
 * How long finished delivery jobs stay in Redis. Each job hash holds the
 * request body (ids only otherwise, never a secret: P9-5), so without a limit
 * they piled up forever. Age only, never a count: enqueueDelivery dedupes
 * an idempotency key with getJob(jobId), which works only while the first job
 * is still kept, and a count cap would evict it after a burst of other traffic.
 * The delivery history itself lives in the webhook_delivery table.
 */
export const WEBHOOK_JOB_RETENTION = {
  removeOnComplete: { age: 7 * DAY_SECONDS },
  removeOnFail: { age: 14 * DAY_SECONDS },
} as const;

/** Shared BullMQ producer handle. Re-exposed as `WebhookService.QUEUE`. */
export const webhookQueue = new Queue<WebhookJobData>(WEBHOOK_QUEUE_NAME, {
  connection: getBullMQConnection(),
  defaultJobOptions: WEBHOOK_JOB_RETENTION,
});

// One consumer per process, even when several bundle layers each load this file.
const WORKER_SLOT = Symbol.for('nb.worker.webhookDeliveryQueue');
const workerStore = globalThis as typeof globalThis & { [WORKER_SLOT]?: Worker<WebhookJobData> };

/**
 * Starts the worker that drains the queue into the delivery engine. Called from
 * the `common:boot_task` consumer phase, never at import: importing this file to
 * enqueue (any route that fires a webhook) no longer starts consuming, and the
 * worker registers a drain so SIGTERM waits for the delivery in flight. Idempotent.
 */
export function startWebhookWorker(): Worker<WebhookJobData> {
  const existing = workerStore[WORKER_SLOT];
  if (existing) return existing;
  const worker = new Worker<WebhookJobData>(
    WEBHOOK_QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      const delivery = await resolveDeliveryJob(job.data);
      if (!delivery) return;
      // webhook.10: a failed attempt with retries left (or one that could not be recorded) fails the job, so BullMQ backs off
      // and runs it again; returning normally used to end the job and leave the PENDING row's `nextRetryAt` unread.
      const { retry } = await WebhookDeliveryService.attemptDelivery(delivery);
      if (retry) throw new Error(`webhook delivery ${delivery.deliveryId} will be retried`);
    },
    {
      connection: getBullMQConnection(),
      concurrency: 10,
      // 41-ui-fixes/12 4.2: a job's backoff type `webhook` waits the delay its own data names for that retry (the tenant's
      // `webhookRetryDelaysMs`), the same one the row's `nextRetryAt` shows; BullMQ's `exponential` doubled the first one.
      settings: { backoffStrategy: webhookBackoffStrategy },
    },
  );
  workerStore[WORKER_SLOT] = worker;
  registerWorkerDrain(worker);
  return worker;
}

/** The reason a delivery row records when its job could not be handed to the queue (webhook.11). */
export const QUEUE_HANDOFF_FAILED = 'Queue unavailable: the delivery was not enqueued.';

/**
 * webhook.11: a failed hand-off marks the row FAILED (with the reason), so no PENDING row is left that has no job behind
 * it and can never finish. FAILED keeps it redeliverable. Best-effort: the caller rethrows the queue's error either way.
 * 41-ui-fixes/12 1.5: only a row that is still PENDING under this hand-off's own claim moves; a row another request has
 * claimed (or a worker has finished) since is not this hand-off's to fail.
 */
export async function recordHandOffFailure(tenantId: string, deliveryId: string, claimId: string): Promise<void> {
  await withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, (deliveryRepo) =>
    deliveryRepo.update({ deliveryId, tenantId, status: 'PENDING', claimId }, { status: 'FAILED', errorMessage: QUEUE_HANDOFF_FAILED } as never),
  ).catch(() => { /* the row stays PENDING; the reason is logged by the caller */ });
}

/**
 * Persist a PENDING delivery row for `webhook` and enqueue its delivery job.
 * Applies the per-endpoint rate limit (deferring rather than dropping when over
 * limit). Event filters are NOT applied here: dispatch and the targeted delivery
 * check `passesEventFilter` before calling it, and the manual trigger refuses an
 * event the endpoint's filter would drop (webhook.redeliver.service.ts).
 */
export async function enqueueDelivery(
  webhook: WebhookEntity,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  /**
   * `idempotencyKey` (a flow's side-effect key) makes the job id deterministic, so enqueueing the same key for the same
   * endpoint twice is one delivery (the second call returns the first one's delivery id), and it is sent to the receiver
   * as `X-Idempotency-Key`. Without it a delivery is always new, as before.
   * `manual`: an admin triggered it by hand; the body says so (`manual: true`) and so does the `X-Webhook-Manual` header (41-ui-fixes/12 2.1).
   */
  opts: { idempotencyKey?: string; manual?: boolean } = {},
): Promise<string> {
  // BullMQ refuses ':' in a custom id, so the key is hashed together with the endpoint
  const jobId = opts.idempotencyKey ? `idem-${createHash('sha256').update(`${webhook.webhookId}\0${opts.idempotencyKey}`).digest('hex').slice(0, 40)}` : undefined;
  if (jobId) {
    const existing = await webhookQueue.getJob(jobId);
    if (existing) return (existing.data as WebhookJobData).deliveryId;
  }
  const config = await resolveDeliveryConfig(webhook.tenantId);

  // Per-endpoint rate limit (sliding window). When the endpoint is over its
  // limit we defer the job by ~one window instead of dropping the event.
  let deferDelayMs = 0;
  const rateLimit = webhook.rateLimitPerMinute ?? config.defaultRateLimitPerMinute;
  if (rateLimit && rateLimit > 0) {
    try {
      const rl = await checkWebhookRateLimit(webhook.webhookId, rateLimit);
      if (!rl.success) {
        deferDelayMs = 60_000;
        Logger.warn(`[Webhook] rate limit hit for webhook=${webhook.webhookId} (${rateLimit}/min) — deferring delivery ~60s`);
      }
    } catch (err) {
      Logger.warn(`[Webhook] rate-limit check failed for webhook=${webhook.webhookId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The subscription's format: the platform's own envelope (default) or a CloudEvents 1.0 event in structured mode (webhook.envelope.ts).
  const { envelope, contentType } = buildEnvelope(webhook.format as WebhookFormat, {
    webhookId: webhook.webhookId, tenantId: webhook.tenantId, event, payload, ...(opts.manual && { manual: true }),
  });
  const requestBody = JSON.stringify(envelope);

  // The delivery row in its own block; the queue hand-off after it commits. The row and its job share a fresh claim id
  // (41-ui-fixes/12 1.5): the worker sends only while the row still carries it.
  const claimId = randomUUID();
  const saved = await withTenantRepositoryFor(webhook.tenantId, WebhookDeliveryEntity, (deliveryRepo) => deliveryRepo.save(deliveryRepo.create({
    webhookId: webhook.webhookId,
    tenantId: webhook.tenantId,
    event,
    payload: envelope as Record<string, unknown>,
    status: 'PENDING',
    attempts: 0,
    maxAttempts: config.maxAttempts,
    requestBody,
    responseStatus: null,
    responseBody: null,
    errorMessage: null,
    duration: null,
    nextRetryAt: null,
    claimId,
  })));

  // Ids and the frozen body only: the worker re-loads the endpoint and opens its secrets when it runs (P9-5).
  // webhook.11: a failed hand-off marks the row FAILED (with the reason) before the error goes on.
  try {
    await webhookQueue.add(
      'deliver',
      toWebhookJobData({
        deliveryId: saved.deliveryId,
        tenantId: webhook.tenantId,
        webhookId: webhook.webhookId,
        event,
        requestBody,
        contentType,
        ...(opts.idempotencyKey && { idempotencyKey: opts.idempotencyKey }),
        retryDelaysMs: config.retryDelaysMs,
        claimId,
      }),
      {
        ...(jobId && { jobId }),
        attempts: config.maxAttempts,
        backoff: { type: WEBHOOK_BACKOFF_TYPE },
        ...(deferDelayMs > 0 ? { delay: deferDelayMs } : {}),
      },
    );
  } catch (err) {
    await recordHandOffFailure(webhook.tenantId, saved.deliveryId, claimId);
    throw err;
  }
  return saved.deliveryId;
}

/** Boot-task entry (`common:boot_task`, consumer phase): starts the webhook consumer. */
export async function startWebhookDeliveryWorker(): Promise<void> {
  startWebhookWorker();
}
