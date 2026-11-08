import { z } from 'zod';
import { WebhookDeliveryStatusEnum } from './webhook.enums';

// ─── Webhook (tenant-scoped — root tenant uses tenantId = ROOT_TENANT_ID) ────

export const WebhookSchema = z.object({
  webhookId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  url: z.string().url(),
  secret: z.string(),
  previousSecret: z.string().nullable(),
  previousSecretExpiresAt: z.date().nullable(),
  /** Stored as subscribed; may name events of a module that is no longer installed (they simply never fire). */
  events: z.array(z.string()),
  headers: z.record(z.string(), z.string()).nullable(),
  eventFilters: z.record(z.string(), z.record(z.string(), z.unknown())).nullable(),
  tags: z.array(z.string()).nullable(),
  format: z.enum(['json', 'cloudevents']).default('json'),
  isActive: z.boolean(),
  consecutiveFailures: z.number().int(),
  autoDisabledAt: z.date().nullable(),
  ipAllowlist: z.array(z.string()).nullable(),
  rateLimitPerMinute: z.number().int().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Safe view never leaks current OR previous signing secret.
export const SafeWebhookSchema = WebhookSchema.omit({ secret: true, previousSecret: true });

export type Webhook = z.infer<typeof WebhookSchema>;
export type SafeWebhook = z.infer<typeof SafeWebhookSchema>;

// ─── Delivery ────────────────────────────────────────────────────────────────

export const WebhookDeliverySchema = z.object({
  deliveryId: z.string().uuid(),
  webhookId: z.string().uuid(),
  tenantId: z.string().uuid(),
  event: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: WebhookDeliveryStatusEnum,
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  requestBody: z.string(),
  responseStatus: z.number().int().nullable(),
  responseBody: z.string().nullable(),
  errorMessage: z.string().nullable(),
  duration: z.number().int().nullable(),
  nextRetryAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

/**
 * A row of the deliveries list (41-ui-fixes/12 3.8): the list's columns only. The payload, the request body and the
 * response body stay out of the list answer (the table never shows them, and the bodies can be large). `duration` is ms.
 */
export const WEBHOOK_DELIVERY_LIST_COLUMNS = [
  'deliveryId', 'webhookId', 'tenantId', 'event', 'status', 'attempts', 'maxAttempts', 'responseStatus', 'errorMessage',
  'duration', 'nextRetryAt', 'createdAt', 'updatedAt',
] as const;
export const WebhookDeliveryListRowSchema = WebhookDeliverySchema.pick({
  deliveryId: true, webhookId: true, tenantId: true, event: true, status: true, attempts: true, maxAttempts: true,
  responseStatus: true, errorMessage: true, duration: true, nextRetryAt: true, createdAt: true, updatedAt: true,
});
export type WebhookDeliveryListRow = z.infer<typeof WebhookDeliveryListRowSchema>;

// ─── Metrics ───────────────────────────────────────────────────────────────────

export interface WebhookMetrics {
  /** Total deliveries in scope. */
  total: number;
  /** Delivery counts keyed by status (SUCCESS / PENDING / FAILED / DEAD_LETTERED), without the `skipped` rows. */
  byStatus: Record<string, number>;
  /**
   * Deliveries never sent: dead-lettered because the endpoint was disabled before their job ran (41-ui-fixes/12 3.6).
   * Counted in `total`, but neither in `byStatus` nor in the success rate.
   */
  skipped: number;
  /** SUCCESS / (terminal deliveries that were sent), or null when there are none yet. */
  successRate: number | null;
  avgDurationMs: number | null;
  p95DurationMs: number | null;
  /** Per-event totals + success counts, top 20 by volume. */
  byEvent: { event: string; count: number; success: number }[];
}

// ─── Reporting (time-series, failure analysis, reliability) ─────────────────────

/** One day of delivery outcomes (from `date_trunc('day', createdAt)`). */
export interface WebhookTimeSeriesPoint {
  /** ISO date (start of the UTC day). */
  day: string;
  total: number;
  success: number;
  /** Sent and failed: FAILED, or DEAD_LETTERED for any reason but a disabled endpoint. */
  failed: number;
  /** Never sent: dead-lettered because the endpoint was disabled before the job ran (41-ui-fixes/12 4.3). */
  skipped: number;
}

/** A recurring failure grouped by its error message. */
export interface WebhookFailurePattern {
  errorMessage: string;
  count: number;
}

/** A response-status-code bucket (null = no response, e.g. timeout/DNS). */
export interface WebhookResponseCodeBucket {
  responseStatus: number | null;
  count: number;
}

/** Per-endpoint circuit-breaker / reliability snapshot. */
export interface WebhookEndpointReliability {
  webhookId: string;
  consecutiveFailures: number;
  autoDisabledAt: string | null;
  lastSuccessAt: string | null;
  /**
   * How many deliveries "Replay dead letters" would re-send right now: DEAD_LETTERED, test sends excluded, no time window
   * (the replay's own criteria, `replayableDeadLetterWhere`; 41-ui-fixes/12 1.4). Not limited by the report's `days`.
   */
  deadLetteredCount: number;
}

/** An endpoint the circuit breaker auto-disabled. */
export interface WebhookAutoDisabledEndpoint {
  webhookId: string;
  name: string;
  url: string;
  consecutiveFailures: number;
  autoDisabledAt: string | null;
}

/** Composite report backing the detail Overview tab + list-page reliability panel. */
export interface WebhookReport {
  /** Daily success/failure counts over the window (oldest → newest). */
  timeSeries: WebhookTimeSeriesPoint[];
  /** Top recurring error messages (FAILED / DEAD_LETTERED). */
  topErrors: WebhookFailurePattern[];
  /** Distribution of HTTP response codes. */
  responseCodes: WebhookResponseCodeBucket[];
  /** Endpoints auto-disabled by the circuit breaker (tenant-wide). */
  autoDisabled: WebhookAutoDisabledEndpoint[];
  /** Per-endpoint reliability snapshot — only set when a single webhook is in scope. */
  reliability: WebhookEndpointReliability | null;
}
