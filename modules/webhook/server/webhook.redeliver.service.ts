import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { In, Not } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import { WebhookDelivery as WebhookDeliveryEntity } from './entities/webhook_delivery.entity';
import { WebhookDeliverySchema } from './webhook.types';
import type { WebhookDelivery } from './webhook.types';
import type { WebhookEvent } from './webhook.enums';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import WebhookMessages from './webhook.messages';
import { resolveDeliveryConfig, toWebhookJobData, WEBHOOK_BACKOFF_TYPE, type DeliveryJobData } from './webhook.config';
import { webhookQueue, enqueueDelivery, recordHandOffFailure } from './webhook.queue';
import WebhookDeliveryService from './webhook.delivery.service';
import { buildEnvelope, contentTypeOfBody, type WebhookFormat } from './webhook.envelope';
import { openWebhookSecrets } from './webhook.secrets';
import { hasWebhookFeature } from './webhook.dispatch.service';
import { passesEventFilter } from './webhook.filters';
import { auditWebhook } from './webhook.crud.service';
import { REDELIVERABLE_STATUSES, replayableDeadLetterWhere } from './webhook.dead-letters';

export { REDELIVERABLE_STATUSES, replayableDeadLetterWhere } from './webhook.dead-letters';


/**
 * webhook.02: a manual send (redeliver, replay, test, trigger) goes only to an ACTIVE endpoint. A circuit-broken or
 * admin-disabled endpoint used to keep receiving signed payloads this way; it is re-enabled first (which also resets the breaker).
 */
function assertEndpointActive(webhook: { isActive?: boolean | null }): void {
  if (webhook.isActive === false) {
    throw new AppError(WebhookMessages.ENDPOINT_DISABLED, 409, ErrorCode.CONFLICT, { details: { reason: 'ENDPOINT_DISABLED' } });
  }
}

/**
 * webhook.02 / 41-ui-fixes/12 2.1 (decision d): every manual send is a real delivery, so it needs the plan feature like the
 * fan-out (fails closed). Test, redeliver and replay used to skip it.
 */
async function assertPlanIncludesWebhooks(tenantId: string): Promise<void> {
  if (!(await hasWebhookFeature(tenantId))) {
    throw new AppError(WebhookMessages.NOT_IN_PLAN, 403, ErrorCode.FORBIDDEN, { details: { reason: 'WEBHOOKS_NOT_IN_PLAN' } });
  }
}

/** The endpoint of a manual send, under the caller's tenant: 404, then 409 when disabled, then 403 without the plan feature. */
async function loadSendableEndpoint(tenantId: string, webhookId: string): Promise<WebhookEntity> {
  const webhook = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo.findOne({ where: { webhookId, tenantId } }));
  if (!webhook) throw new AppError(WebhookMessages.NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  assertEndpointActive(webhook);
  await assertPlanIncludesWebhooks(tenantId);
  return webhook;
}

type ClaimResult = { claimed: true; delivery: WebhookDeliveryEntity; claimId: string } | { claimed: false; status: string | null };

/**
 * Claim one delivery for a manual re-send (41-ui-fixes/12 1.4, 1.5, decision c): ONE conditional UPDATE moves it from
 * FAILED / DEAD_LETTERED to a fresh PENDING attempt under a new `claimId`. Of two requests racing for the same row only
 * one moves it; the other sees 0 rows and is refused (redeliver) or skipped (replay), so a delivery is queued at most once
 * per request. The new claim id also retires every job of an earlier claim still in the queue: the worker sends only
 * for the job that carries the row's current one (webhook.job-resolve.ts). Test sends are never claimed.
 */
async function claimDelivery(tenantId: string, webhookId: string, deliveryId: string): Promise<ClaimResult> {
  const claimId = randomUUID();
  return withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, async (repo) => {
    const res = await repo.update(
      { tenantId, webhookId, deliveryId, status: In([...REDELIVERABLE_STATUSES]), event: Not('test') },
      { status: 'PENDING', attempts: 0, nextRetryAt: null, errorMessage: null, claimId } as never,
    );
    const row = await repo.findOne({ where: { tenantId, webhookId, deliveryId } });
    if (!res.affected) return { claimed: false, status: row?.status ?? null };
    return { claimed: true, delivery: row!, claimId };
  });
}

/**
 * Queue the claimed row. The job id is deterministic per claim (`redeliver-<deliveryId>-<claimId>`): repeating this
 * hand-off for the same claim is one job, while a later claim of the same row (a second redeliver after this one failed
 * again) is a new one and is never deduplicated away. The job carries the claim id, so it sends only while the row is
 * still this claim's (1.5). It runs as many attempts as the row allows (its own `maxAttempts`, not the module default)
 * with the tenant's retry delays. A failed hand-off is recorded on the row of this claim like enqueueDelivery does (webhook.11).
 */
async function enqueueClaimed(tenantId: string, webhook: WebhookEntity, delivery: WebhookDeliveryEntity, claimId: string): Promise<void> {
  const config = await resolveDeliveryConfig(tenantId);
  const attempts = Math.min(10, Math.max(1, delivery.maxAttempts || config.maxAttempts));
  try {
    // Ids and the stored body only: the worker re-loads the endpoint and opens its secrets when it runs (P9-5).
    await webhookQueue.add(
      'redeliver',
      toWebhookJobData({
        deliveryId: delivery.deliveryId,
        tenantId: webhook.tenantId,
        webhookId: webhook.webhookId,
        event: delivery.event,
        requestBody: delivery.requestBody,
        contentType: contentTypeOfBody(delivery.requestBody),
        retryDelaysMs: config.retryDelaysMs,
        claimId,
      }),
      { jobId: `redeliver-${delivery.deliveryId}-${claimId}`, attempts, backoff: { type: WEBHOOK_BACKOFF_TYPE } },
    );
  } catch (err) {
    await recordHandOffFailure(tenantId, delivery.deliveryId, claimId);
    throw err;
  }
}

/**
 * Re-send one FAILED or DEAD_LETTERED delivery. Refusals: 404 (no such endpoint or delivery under this tenant and endpoint),
 * 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN`, 409 `TEST_DELIVERY_NOT_REDELIVERABLE` (send a new test instead),
 * 409 `DELIVERY_NOT_REDELIVERABLE` with `details.status` when the row is PENDING or SUCCESS (another request already
 * claimed it, or it was delivered). `actorId` is written to the audit row.
 */
export async function redeliver(tenantId: string, webhookId: string, deliveryId: string, actorId: string | null = null): Promise<void> {
  const webhook = await loadSendableEndpoint(tenantId, webhookId);
  const existing = await withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, (repo) =>
    repo.findOne({ where: { deliveryId, tenantId, webhookId } }));
  if (!existing) throw new AppError(WebhookMessages.DELIVERY_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
  if (existing.event === 'test') {
    throw new AppError(WebhookMessages.TEST_DELIVERY_NOT_REDELIVERABLE, 409, ErrorCode.CONFLICT, {
      details: { reason: 'TEST_DELIVERY_NOT_REDELIVERABLE' },
    });
  }

  const previousStatus = existing.status;
  const claim = await claimDelivery(tenantId, webhookId, deliveryId);
  if (!claim.claimed) {
    throw new AppError(WebhookMessages.DELIVERY_NOT_REDELIVERABLE, 409, ErrorCode.CONFLICT, {
      details: { reason: 'DELIVERY_NOT_REDELIVERABLE', status: claim.status },
    });
  }
  await enqueueClaimed(tenantId, webhook, claim.delivery, claim.claimId);
  auditWebhook(tenantId, actorId, 'webhook.delivery_redelivered', webhookId, { deliveryId, event: claim.delivery.event, previousStatus });
}

/**
 * Replay every dead-lettered delivery of an endpoint (test sends excluded, no time window: `replayableDeadLetterWhere`).
 * Each row is claimed like a single redeliver; a row another request claimed first is skipped, never queued twice.
 * `replayed` rows were queued, `skipped` rows were listed but no longer dead-lettered when claimed. An unknown endpoint
 * has no dead letters here (0 / 0); a disabled endpoint or a plan without webhooks is refused before anything is claimed.
 * A failed queue hand-off stops the replay with the error: the rows queued so far stay queued, the one that failed is
 * marked FAILED (redeliverable alone), the rest stay dead-lettered for the next replay. The audit row is written either
 * way, with `failedDeliveryId` when a hand-off stopped it (41-ui-fixes/12 2.1).
 */
export async function replayDeadLettered(
  tenantId: string,
  webhookId: string,
  actorId: string | null = null,
): Promise<{ replayed: number; skipped: number }> {
  const endpoint = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo.findOne({ where: { webhookId, tenantId } }));
  if (!endpoint) return { replayed: 0, skipped: 0 };
  assertEndpointActive(endpoint);
  await assertPlanIncludesWebhooks(tenantId);

  const dead = await withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, (repo) => repo.find({
    where: replayableDeadLetterWhere(tenantId, webhookId),
    order: { createdAt: 'ASC' },
  }));
  let replayed = 0;
  let skipped = 0;
  let failedDeliveryId: string | null = null;
  try {
    for (const d of dead) {
      // the row in hand: named by the audit row when its claim or its hand-off throws
      failedDeliveryId = d.deliveryId;
      const claim = await claimDelivery(tenantId, webhookId, d.deliveryId);
      if (!claim.claimed) { skipped += 1; failedDeliveryId = null; continue; }
      await enqueueClaimed(tenantId, endpoint, claim.delivery, claim.claimId);
      failedDeliveryId = null;
      replayed += 1;
    }
  } finally {
    // (41-ui-fixes/12 2.1) a replay a hand-off stopped half way is audited too: what was queued, skipped and where it stopped
    if (dead.length > 0) {
      auditWebhook(tenantId, actorId, 'webhook.dead_letters_replayed', webhookId, {
        replayed, skipped, ...(failedDeliveryId && { failedDeliveryId }),
      });
    }
  }
  return { replayed, skipped };
}

/**
 * Send `event: 'test'` synchronously and return the recorded outcome. Refusals: 404, 409 `ENDPOINT_DISABLED`,
 * 403 `WEBHOOKS_NOT_IN_PLAN`. A test send never moves the circuit breaker (WebhookDeliveryService) and is never replayed.
 */
export async function sendTest(tenantId: string, webhookId: string, actorId: string | null = null): Promise<WebhookDelivery> {
  const webhook = await loadSendableEndpoint(tenantId, webhookId);

  const { envelope, contentType } = buildEnvelope(webhook.format as WebhookFormat, { webhookId: webhook.webhookId, tenantId: webhook.tenantId, event: 'test', payload: { message: WebhookMessages.TEST_DELIVERY_MESSAGE } });
  const requestBody = JSON.stringify(envelope);

  const saved = await withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, (deliveryRepo) => deliveryRepo.save(deliveryRepo.create({
    webhookId: webhook.webhookId,
    tenantId: webhook.tenantId,
    event: 'test',
    payload: envelope as Record<string, unknown>,
    status: 'PENDING',
    attempts: 0,
    maxAttempts: 1,
    requestBody,
    responseStatus: null,
    responseBody: null,
    errorMessage: null,
    duration: null,
    nextRetryAt: null,
  })));

  // The delivery itself — an outbound HTTP call — runs while no block is open.
  const { secret } = await openWebhookSecrets(webhook, { withPrevious: false });
  await WebhookDeliveryService.execute({
    deliveryId: saved.deliveryId,
    tenantId: webhook.tenantId,
    webhookId: webhook.webhookId,
    url: webhook.url,
    secret,
    event: 'test',
    payload: envelope as Record<string, unknown>,
    requestBody,
    contentType,
    headers: webhook.headers,
    ipAllowlist: webhook.ipAllowlist,
  } satisfies DeliveryJobData);

  const updated = await withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, (repo) =>
    repo.findOne({ where: { tenantId, deliveryId: saved.deliveryId } }));
  const out = WebhookDeliverySchema.parse(updated!);
  auditWebhook(tenantId, actorId, 'webhook.test_sent', webhookId, { deliveryId: out.deliveryId, status: out.status, responseStatus: out.responseStatus });
  return out;
}

/**
 * Manually trigger a real catalog event against a single endpoint with a sample payload. Unlike {@link sendTest}
 * (synchronous `event:'test'`), this enqueues a genuine `<event>` delivery through the normal async pipeline (retries,
 * signing, rate limit) so an admin can verify an integration end-to-end. It bypasses the subscription list (the admin
 * explicitly chose this webhook + event) but NOT the endpoint's event filter: a sample the filter would drop is refused
 * (422, `details.reason = 'EVENT_FILTERED_OUT'`, with the filter), so the admin is not told an endpoint receives what it
 * never would. The delivery is marked manual (41-ui-fixes/12 2.1): `manual: true` in the body, `X-Webhook-Manual: true` on
 * the request. Other refusals: 404, 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN`. Returns the delivery id.
 */
export async function triggerEvent(
  tenantId: string,
  webhookId: string,
  event: WebhookEvent,
  samplePayload: Record<string, unknown> = {},
  actorId: string | null = null,
): Promise<string> {
  const webhook = await loadSendableEndpoint(tenantId, webhookId);
  if (!passesEventFilter(webhook, event, samplePayload)) {
    throw new AppError(WebhookMessages.EVENT_FILTERED_OUT, 422, ErrorCode.VALIDATION_ERROR, {
      details: { reason: 'EVENT_FILTERED_OUT', event, filter: webhook.eventFilters?.[event] ?? null },
    });
  }
  const deliveryId = await enqueueDelivery(webhook, event, samplePayload, { manual: true });
  auditWebhook(tenantId, actorId, 'webhook.event_triggered', webhookId, { event, deliveryId });
  return deliveryId;
}
