import Logger from '@kuraykaraaslan-labs/logger';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { WEBHOOK_INTEGER_SETTINGS, parseDelayList } from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.validation';

/**
 * What the delivery queue stores in Redis (P9-5): ids and the frozen request body, nothing else. The signing secrets, the
 * endpoint URL (a Slack-style URL is itself a bearer secret), the custom headers (an `Authorization` header) and the IP
 * allowlist stay in the `webhook` row and are re-loaded by `webhookId` when the worker runs the job (`resolveDeliveryJob`
 * in webhook.queue.ts), so a rotated secret or a fixed URL applies to every job still waiting. A job enqueued by an older
 * build may still carry those fields: the worker ignores them.
 */
export interface WebhookJobData {
  deliveryId: string;
  tenantId: string;
  webhookId: string;
  event: string;
  /** The exact bytes to POST, frozen at enqueue time so a retry signs the same body. */
  requestBody: string;
  /** The Content-Type of `requestBody` (`application/cloudevents+json` for a CloudEvents subscription). Absent: derived from the body, so a redelivered body keeps the format it was made in. */
  contentType?: string;
  /** Sent as `X-Idempotency-Key`: the side-effect key of the caller (an automation flow), so a receiver can deduplicate a retry. */
  idempotencyKey?: string;
  /**
   * The wait before retry 1, 2, ... (ms), frozen at enqueue time from the tenant's `webhookRetryDelaysMs` (41-ui-fixes/12 4.2). The queue's
   * backoff (`webhookBackoffStrategy`) and the row's `nextRetryAt` both read it, so the time the row promises is the time the job runs.
   * Absent on a job of an older build: the tenant's current setting is used.
   */
  retryDelaysMs?: number[];
  /**
   * The claim this job belongs to (41-ui-fixes/12 1.5): the same id is written on the delivery row when the job is queued
   * (enqueue, redeliver, replay). The worker sends only while the row still carries it (`jobMatchesClaim`). An id, never a
   * secret (named `…Id`: the job-data guard refuses a `…Token` key). Absent on a job of an older build.
   */
  claimId?: string;
}

/**
 * A delivery resolved for one attempt: the queued job plus the endpoint as it is now. Built in memory by the worker
 * (`resolveDeliveryJob`) or by `sendTest`, handed to `WebhookDeliveryService.execute`, and never enqueued.
 */
export interface DeliveryJobData extends WebhookJobData {
  url: string;
  secret: string;
  /** Set during a secret-rotation window; receivers can use either signature. */
  previousSecret?: string | null;
  /** The envelope `requestBody` was made from (informational; the body is what is sent). */
  payload?: Record<string, unknown>;
  /** Per-endpoint custom headers, sanitized of reserved names before sending. */
  headers?: Record<string, string> | null;
  /** SSRF override: destination must resolve into one of these IPs/CIDRs. */
  ipAllowlist?: string[] | null;
}

/** The queued job's fields and nothing else: a legacy job's secret, URL or headers never travel on (P9-5). */
export function toWebhookJobData(data: WebhookJobData): WebhookJobData {
  return {
    deliveryId: data.deliveryId,
    tenantId: data.tenantId,
    webhookId: data.webhookId,
    event: data.event,
    requestBody: data.requestBody,
    ...(data.contentType && { contentType: data.contentType }),
    ...(data.idempotencyKey && { idempotencyKey: data.idempotencyKey }),
    ...(isDelayList(data.retryDelaysMs) && { retryDelaysMs: [...data.retryDelaysMs] }),
    ...(typeof data.claimId === 'string' && data.claimId && { claimId: data.claimId }),
  };
}

function isDelayList(v: unknown): v is number[] {
  return Array.isArray(v) && v.length > 0 && v.every((n) => Number.isSafeInteger(n) && n >= 0);
}

export const MAX_ATTEMPTS = 3;
// Exponential backoff: attempt 1 → 60s, attempt 2 → 300s, attempt 3 → 900s
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000];
export const REQUEST_TIMEOUT_MS = 15_000;

// Setting keys (see webhook.settings.fields.ts) read per-tenant at dispatch /
// delivery time. Absent or unparseable values fall back to the constants above.
const SETTING_MAX_ATTEMPTS = 'webhookMaxAttempts';
const SETTING_RETRY_DELAYS = 'webhookRetryDelaysMs';
const SETTING_REQUEST_TIMEOUT = 'webhookRequestTimeoutMs';
const SETTING_CIRCUIT_BREAKER_THRESHOLD = 'webhookCircuitBreakerThreshold';
const SETTING_DEFAULT_RATE_LIMIT = 'webhookDefaultRateLimitPerMinute';

const DEFAULT_CIRCUIT_BREAKER_THRESHOLD = 10;

export interface DeliveryConfig {
  maxAttempts: number;
  retryDelaysMs: number[];
  timeoutMs: number;
  /** Auto-disable an endpoint after this many consecutive failed deliveries. */
  circuitBreakerThreshold: number;
  /** Fallback per-endpoint rate limit (deliveries/min) when a webhook has none. Null = unlimited. */
  defaultRateLimitPerMinute: number | null;
}

export const DEFAULT_DELIVERY_CONFIG: DeliveryConfig = {
  maxAttempts: MAX_ATTEMPTS,
  retryDelaysMs: RETRY_DELAYS_MS,
  timeoutMs: REQUEST_TIMEOUT_MS,
  circuitBreakerThreshold: DEFAULT_CIRCUIT_BREAKER_THRESHOLD,
  defaultRateLimitPerMinute: null,
};

/**
 * The BullMQ backoff type of a delivery job (41-ui-fixes/12 4.2). Not a built-in type, so BullMQ asks the worker's own
 * `backoffStrategy` (`webhookBackoffStrategy`), which waits the configured delay for that retry instead of
 * doubling the first one. A job of an older build still says `exponential` and keeps BullMQ's own behaviour.
 */
export const WEBHOOK_BACKOFF_TYPE = 'webhook';

/** The wait before the retry that follows `attemptsMade` attempts: the list's entry for it, the last entry past the list. */
export function retryDelayFor(delays: readonly number[] | undefined, attemptsMade: number): number {
  const list = delays && delays.length > 0 ? delays : RETRY_DELAYS_MS;
  return list[Math.max(0, attemptsMade - 1)] ?? list.at(-1) ?? RETRY_DELAYS_MS.at(-1)!;
}

/** The worker's custom backoff (the BullMQ worker setting `backoffStrategy`): the delay list the job carries, else the defaults. */
export function webhookBackoffStrategy(attemptsMade: number, _type?: string, _err?: Error, job?: { data?: unknown }): number {
  const delays = (job?.data as { retryDelaysMs?: unknown } | undefined)?.retryDelaysMs;
  return retryDelayFor(isDelayList(delays) ? delays : undefined, attemptsMade);
}

/**
 * A stored integer setting (41-ui-fixes/12 4.1): a whole number is clamped into the range the save validates (the
 * direction of the value is kept: 50 attempts read as 10, never as the default 3); anything that is not a whole number
 * (empty, "12abc", "-5") reads as the default. Saves are validated now, so only a value stored before that rule lands here.
 */
function readInteger(raw: string | undefined, fallback: number, rule: { min: number; max?: number }): number {
  const v = (raw ?? '').trim();
  if (!/^\d+$/.test(v)) return fallback;
  const n = Number(v);
  if (!Number.isSafeInteger(n)) return rule.max ?? fallback;
  return Math.min(rule.max ?? Number.MAX_SAFE_INTEGER, Math.max(rule.min, n));
}

/**
 * Resolve the per-tenant delivery tuning (max attempts, retry backoff, request
 * timeout) from the settings store, falling back to the module defaults for any
 * key that is missing or unparseable. Settings are Redis-cached by
 * {@link SettingService}, so this is cheap to call on the hot path. Best-effort:
 * any failure resolves to {@link DEFAULT_DELIVERY_CONFIG} so delivery never
 * breaks on a settings read.
 */
export async function resolveDeliveryConfig(tenantId: string): Promise<DeliveryConfig> {
  try {
    const values = await SettingService.getByKeys(tenantId, [
      SETTING_MAX_ATTEMPTS,
      SETTING_RETRY_DELAYS,
      SETTING_REQUEST_TIMEOUT,
      SETTING_CIRCUIT_BREAKER_THRESHOLD,
      SETTING_DEFAULT_RATE_LIMIT,
    ]);

    const maxAttempts = readInteger(values[SETTING_MAX_ATTEMPTS], MAX_ATTEMPTS, WEBHOOK_INTEGER_SETTINGS[SETTING_MAX_ATTEMPTS]!);
    const timeoutMs = readInteger(values[SETTING_REQUEST_TIMEOUT], REQUEST_TIMEOUT_MS, WEBHOOK_INTEGER_SETTINGS[SETTING_REQUEST_TIMEOUT]!);
    const circuitBreakerThreshold = readInteger(
      values[SETTING_CIRCUIT_BREAKER_THRESHOLD], DEFAULT_CIRCUIT_BREAKER_THRESHOLD, WEBHOOK_INTEGER_SETTINGS[SETTING_CIRCUIT_BREAKER_THRESHOLD]!,
    );

    // 0 and empty both mean "no limit" (the save accepts 0 for it); a value that is not a whole number reads as no limit too.
    const rateLimit = readInteger(values[SETTING_DEFAULT_RATE_LIMIT], 0, WEBHOOK_INTEGER_SETTINGS[SETTING_DEFAULT_RATE_LIMIT]!);
    const defaultRateLimitPerMinute = rateLimit > 0 ? rateLimit : null;

    // A list with any bad entry reads as the defaults whole: dropping the entry would move every later delay to the wrong retry.
    const parsedDelays = parseDelayList(values[SETTING_RETRY_DELAYS] ?? '');
    const retryDelaysMs = parsedDelays && parsedDelays.length > 0 ? parsedDelays : RETRY_DELAYS_MS;

    return { maxAttempts, retryDelaysMs, timeoutMs, circuitBreakerThreshold, defaultRateLimitPerMinute };
  } catch (err) {
    Logger.warn(
      `[Webhook] resolveDeliveryConfig fell back to defaults for tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return DEFAULT_DELIVERY_CONFIG;
  }
}
