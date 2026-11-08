import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import { WebhookDelivery as WebhookDeliveryEntity } from './entities/webhook_delivery.entity';
import { isReservedHeaderName } from './webhook.dto';
import { assertSafeWebhookUrl } from './webhook.ssrf';
import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch';
import Logger from '@kuraykaraaslan-labs/logger';
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service';
import { signPayload } from './webhook.crypto';
import { isFieldEnvelope } from '@kuraykaraaslan-labs/common/server/field-encryption';
import { contentTypeOfBody, isManualBody } from './webhook.envelope';
import { resolveDeliveryConfig, retryDelayFor, type DeliveryJobData } from './webhook.config';

/** The recorded error of an attempt whose signing secret cannot be decrypted on this node; it names no secret. */

/** The stored response body is capped at this many characters. */
const RESPONSE_BODY_CAP = 4096;

/**
 * webhook.04: at most `max` characters of a response body, read chunk by chunk; the stream is cancelled as soon as the cap is
 * reached, so an endpoint that streams gigabytes (or a decompression bomb) is not read to the end in the worker. A response
 * without a stream (a test double) falls back to `text()`.
 */
async function readResponsePrefix(response: { body?: ReadableStream<Uint8Array> | null; text(): Promise<string> }, max: number): Promise<string> {
  const stream = response.body;
  if (!stream || typeof stream.getReader !== 'function') return (await response.text()).slice(0, max);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = '';
  try {
    while (out.length < max) {
      const { done, value } = await reader.read();
      if (done) break;
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.slice(0, max);
}

export const SECRET_UNREADABLE = 'the signing secret cannot be decrypted on this node (missing or rotated SETTINGS_ENCRYPTION_KEY?)';

/**
 * Webhook HTTP delivery engine: performs the signed POST (SSRF-checked, v1+v2
 * signatures), records the delivery outcome, schedules retries / dead-letters
 * exhausted deliveries, and drives the per-endpoint circuit breaker. Invoked by
 * the BullMQ worker (see `webhook.queue.ts`) and by `WebhookService.sendTest`.
 */
export default class WebhookDeliveryService {

  static async execute(data: DeliveryJobData): Promise<void> {
    await WebhookDeliveryService.attemptDelivery(data);
  }

  /**
   * One attempt, and whether the queue must run the job again (webhook.10): `retry` is true when the attempt failed with
   * retries left (the row says PENDING with a `nextRetryAt` that nothing else reads) or when the attempt could not be recorded
   * (a database failure: the outcome is otherwise lost). The worker throws on `retry`, so BullMQ backs off and runs it again.
   */
  static async attemptDelivery(data: DeliveryJobData): Promise<{ retry: boolean }> {
    const { deliveryId, tenantId, url, requestBody } = data;
    // The secrets are field-encrypted at rest (P9-6). One this node cannot decrypt reaches here as its envelope
    // (common encryptedColumnTransformer): never sign with it, the receiver would reject the delivery as forged.
    // An unreadable current secret fails the attempt without sending; an unreadable previous one is dropped.
    const secretUnreadable = isFieldEnvelope(data.secret);
    const secret = secretUnreadable ? '' : data.secret;
    const previousSecret = isFieldEnvelope(data.previousSecret) ? null : data.previousSecret;
    const config = await resolveDeliveryConfig(tenantId);

    // v1 (legacy): HMAC over the raw body. v2 (replay-resistant, Stripe-style):
    // HMAC over `${timestamp}.${body}` with the timestamp also sent as a header so
    // the receiver can reject stale deliveries. Both are sent during a deprecation
    // window so existing v1 verifiers keep working.
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signedV2 = `${timestamp}.${requestBody}`;
    const signature = signPayload(secret, requestBody);
    const signatureV2 = signPayload(secret, signedV2);
    const previousSignature = previousSecret ? signPayload(previousSecret, requestBody) : null;
    const previousSignatureV2 = previousSecret ? signPayload(previousSecret, signedV2) : null;
    const startedAt = Date.now();

    let responseStatus: number | null = null;
    let responseBody: string | null = null;
    let errorMessage: string | null = null;
    let status: 'SUCCESS' | 'FAILED' = 'FAILED';

    const headers: Record<string, string> = {
      'Content-Type': data.contentType ?? contentTypeOfBody(requestBody),
      'X-Webhook-Signature': signature,
      'X-Webhook-Signature-V2': signatureV2,
      'X-Webhook-Timestamp': timestamp,
      'X-Webhook-Event': data.event,
      'X-Webhook-Delivery': deliveryId,
      'User-Agent': 'NextBoilerplate-Webhooks/1.0',
      ...(data.idempotencyKey && { 'X-Idempotency-Key': data.idempotencyKey }),
      // 41-ui-fixes/12 2.1: an event an admin triggered by hand says so; read from the signed body, so every retry and redelivery says it too.
      ...(isManualBody(requestBody) && { 'X-Webhook-Manual': 'true' }),
    };
    if (previousSignature) {
      headers['X-Webhook-Signature-Prev'] = previousSignature;
    }
    if (previousSignatureV2) {
      headers['X-Webhook-Signature-V2-Prev'] = previousSignatureV2;
    }
    // Merge per-endpoint custom headers, dropping any reserved name as a second
    // line of defence behind the DTO validation (a header could have been
    // persisted before validation tightened, or set out-of-band).
    if (data.headers) {
      for (const [key, value] of Object.entries(data.headers)) {
        if (!isReservedHeaderName(key)) headers[key] = value;
      }
    }

    try {
      if (secretUnreadable) throw new Error(SECRET_UNREADABLE);
      // Fast create/update-style pre-check for a clear early error; safeFetch
      // below is the authoritative guard — it PINS the validated IP for the
      // connection, so there is no rebinding window between resolve and connect.
      await assertSafeWebhookUrl(url, data.ipAllowlist);

      const response = await safeFetch(url, {
        method: 'POST',
        headers,
        body: requestBody,
        // Do not follow redirects — prevents an endpoint from bouncing a delivery
        // to a private/internal address (SSRF via redirect / DNS rebinding).
        redirect: 'manual',
        signal: AbortSignal.timeout(config.timeoutMs),
      }, { ipAllowlist: data.ipAllowlist });

      responseStatus = response.status;
      // undici's Response and the DOM type differ only in their stream typing: the helper reads body and text() alone.
      responseBody = await readResponsePrefix(response as unknown as Parameters<typeof readResponsePrefix>[0], RESPONSE_BODY_CAP);
      status = response.ok ? 'SUCCESS' : 'FAILED';

      // Count the delivery attempt toward the tenant's monthly usage.
      TenantUsageService.incrementWebhookCall(tenantId).catch(() => {});

      if (!response.ok) {
        errorMessage = `HTTP ${response.status}`;
      }
    } catch (err: unknown) {
      errorMessage = (err as { message?: string } | null)?.message ?? 'Unknown error';
    }

    const duration = Date.now() - startedAt;

    // The swallowing catch wraps the block, never sits inside it; the HTTP
    // call above ran with no block open (docs/phases/10-db Faz 3).
    let recorded = false;
    let pendingRetry = false;
    let recordFailed = false;
    try {
      recorded = await withTenantRepositoryFor(tenantId, WebhookDeliveryEntity, async (repo) => {
        const row = await repo.findOne({ where: { tenantId, deliveryId } });
        if (!row) return false;

        row.status = status;
        row.attempts = row.attempts + 1;
        row.responseStatus = responseStatus;
        row.responseBody = responseBody;
        row.errorMessage = errorMessage;
        row.duration = duration;

        if (status === 'FAILED') {
          if (row.attempts < row.maxAttempts) {
            // Recoverable failure — schedule next retry using the per-tenant backoff. The job's own delay list (frozen at
            // enqueue) is the one the queue's backoff waits (webhookBackoffStrategy), so the row shows when it really runs (41-ui-fixes/12 4.2).
            const delay = retryDelayFor(data.retryDelaysMs ?? config.retryDelaysMs, row.attempts);
            row.nextRetryAt = new Date(Date.now() + delay);
            row.status = 'PENDING';
            pendingRetry = true;
          } else {
            // All retries exhausted — move to the dead-letter queue. Stays
            // queryable for admins to inspect or replay manually via
            // WebhookService.redeliver().
            row.status = 'DEAD_LETTERED';
            row.nextRetryAt = null;
            Logger.warn(
              `[Webhook] Delivery ${deliveryId} dead-lettered after ${row.attempts} attempts (tenant=${tenantId})`,
            );
          }
        }

        await repo.save(row);
        return true;
      });
    } catch (err) {
      Logger.error(`[Webhook] Failed to update delivery record ${deliveryId}: ${err}`);
      recordFailed = true;
      pendingRetry = false;
    }

    // Circuit breaker: a successful attempt resets the counter; repeated
    // failures eventually auto-disable the endpoint. Its own block. A test send moves it neither way
    // (41-ui-fixes/12 4.2): a failed test must not disable a live endpoint, a passing one must not hide real failures.
    if (recorded && data.event !== 'test') {
      await WebhookDeliveryService.applyCircuitBreaker(tenantId, data.webhookId, status === 'SUCCESS', config.circuitBreakerThreshold);
    }
    return { retry: pendingRetry || recordFailed };
  }

  /**
   * Track consecutive failed deliveries per endpoint and auto-disable an endpoint
   * once it crosses the circuit-breaker threshold. A success resets the counter.
   * Best-effort — a failure here must not break delivery recording.
   */
  private static async applyCircuitBreaker(
    tenantId: string,
    webhookId: string,
    success: boolean,
    threshold: number,
  ): Promise<void> {
    // Locked: concurrent deliveries to one endpoint each incremented a counter
    // they had read unlocked, so failures were lost and the breaker tripped
    // late. The swallowing catch wraps the block (docs/phases/10-db Faz 3).
    try {
      await withTenantRepositoryFor(tenantId, WebhookEntity, async (repo) => {
        const webhook = await repo.findOne({ where: { webhookId, tenantId }, lock: { mode: 'pessimistic_write' } });
        if (!webhook) return;

        if (success) {
          if ((webhook.consecutiveFailures ?? 0) !== 0) {
            webhook.consecutiveFailures = 0;
            await repo.save(webhook);
          }
          return;
        }

        webhook.consecutiveFailures = (webhook.consecutiveFailures ?? 0) + 1;
        if (webhook.isActive && webhook.consecutiveFailures >= threshold) {
          webhook.isActive = false;
          webhook.autoDisabledAt = new Date();
          Logger.warn(
            `[Webhook] Endpoint ${webhookId} auto-disabled after ${webhook.consecutiveFailures} consecutive failures (tenant=${tenantId})`,
          );
        }
        await repo.save(webhook);
      });
    } catch (err) {
      Logger.error(`[Webhook] circuit-breaker update failed for webhook=${webhookId}: ${err}`);
    }
  }
}
