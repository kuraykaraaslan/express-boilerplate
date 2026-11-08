import { z } from 'zod';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { WebhookEventNameSchema, WebhookDeliveryStatusEnum } from './webhook.enums';

// ─── Custom headers ────────────────────────────────────────────────────────────

/**
 * Transport/signature headers a custom header must never override. Enforced both
 * here (input validation) and in `WebhookService._executeDelivery` (defense in
 * depth — see {@link isReservedHeaderName}).
 */
export const RESERVED_HEADER_NAMES = new Set(['content-type', 'content-length', 'host', 'user-agent', 'x-idempotency-key']);

export function isReservedHeaderName(name: string): boolean {
  const lower = name.toLowerCase();
  return RESERVED_HEADER_NAMES.has(lower) || lower.startsWith('x-webhook-');
}

// RFC 7230 token characters — also blocks CR/LF, so header-name injection is impossible.
const HEADER_NAME_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

const CustomHeadersSchema = z
  .record(z.string(), z.string())
  .refine((h) => Object.keys(h).length <= 20, { message: 'At most 20 custom headers are allowed.' })
  .refine((h) => Object.keys(h).every((k) => HEADER_NAME_RE.test(k)), {
    message: 'Header names may only contain RFC 7230 token characters.',
  })
  .refine((h) => Object.keys(h).every((k) => !isReservedHeaderName(k)), {
    message: 'Reserved headers (Content-Type, User-Agent, X-Webhook-*, …) cannot be overridden.',
  })
  .refine((h) => Object.values(h).every((v) => v.length <= 1000 && !/[\r\n]/.test(v)), {
    message: 'Header values must be single-line and at most 1000 characters.',
  });

// Per-event payload filters: { '<event>': { '<dot.path>': expectedValue } }.
const EventFiltersSchema = z
  .record(z.string(), z.record(z.string(), z.unknown()))
  .refine((f) => Object.keys(f).length <= 50, { message: 'Too many event filters.' });

const TagsSchema = z.array(z.string().min(1).max(40)).max(20);

// IPs or IPv4 CIDRs the destination host is allowed to resolve to (SSRF override).
const IpAllowlistSchema = z
  .array(z.string().regex(/^[0-9a-fA-F:.]+(\/\d{1,3})?$/, 'Each allowlist entry must be an IP or CIDR.'))
  .max(50);

/**
 * Plain-http webhook hosts the OPERATOR allows (env WEBHOOK_HTTP_ALLOWED_HOSTS, comma-separated host or host:port), e.g. an
 * internal receiver without TLS. Read at validation time so a deployment can change it without a rebuild.
 */
export function httpWebhookHostAllowed(url: string): boolean {
  const allowed = String(process.env.WEBHOOK_HTTP_ALLOWED_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);
  if (allowed.length === 0) return false;
  try {
    const u = new URL(url);
    return allowed.includes(u.host.toLowerCase()) || allowed.includes(u.hostname.toLowerCase());
  } catch {
    return false;
  }
}

/**
 * webhook.05 + decision 2026-10-20 (HTTPS only): a webhook URL is https on create AND update; plain http only for a host
 * the operator allowlisted. (PATCH used to store file:, javascript:, ….)
 */
const WebhookUrlSchema = z.string().url().max(2048).refine((u) => u.startsWith('https://') || (u.startsWith('http://') && httpWebhookHostAllowed(u)), {
  message: 'Webhook URL must be a valid HTTPS URL',
});
/**
 * webhook.09: a bounded list (a 100 000-element array used to reach the service); there are far fewer event types.
 * The names are checked for shape here and against the declared catalog (`webhook:event_type`) by the service.
 */
const MAX_WEBHOOK_EVENTS = 200;
/** The length is checked on an untyped array FIRST, so an oversized list is one cheap issue, not one issue per element. */
const WebhookEventsSchema = z.array(z.unknown()).max(MAX_WEBHOOK_EVENTS).pipe(z.array(WebhookEventNameSchema).min(1));

export const CreateWebhookDTO = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  url: WebhookUrlSchema,
  events: WebhookEventsSchema,
  headers: CustomHeadersSchema.optional(),
  eventFilters: EventFiltersSchema.optional(),
  tags: TagsSchema.optional(),
  rateLimitPerMinute: z.number().int().min(1).max(100_000).nullable().optional(),
  ipAllowlist: IpAllowlistSchema.optional(),
  /** Body format of every delivery: the platform envelope (default) or a CloudEvents 1.0 event in structured mode. */
  format: z.enum(['json', 'cloudevents']).optional(),
});

export const UpdateWebhookDTO = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  url: WebhookUrlSchema.optional(),
  events: WebhookEventsSchema.optional(),
  isActive: z.boolean().optional(),
  // Nullable so an admin can clear a previously-set value.
  headers: CustomHeadersSchema.nullable().optional(),
  eventFilters: EventFiltersSchema.nullable().optional(),
  tags: TagsSchema.nullable().optional(),
  rateLimitPerMinute: z.number().int().min(1).max(100_000).nullable().optional(),
  ipAllowlist: IpAllowlistSchema.nullable().optional(),
  format: z.enum(['json', 'cloudevents']).optional(),
});

/** webhook.08: the largest sample payload a manual trigger carries, serialised (64 KiB); it is stored twice and queued. */
export const MAX_TRIGGER_PAYLOAD_BYTES = 64 * 1024;

export const TriggerWebhookDTO = z.object({
  event: WebhookEventNameSchema,
  payload: z.record(z.string(), z.unknown()).optional().refine(
    (p) => p === undefined || Buffer.byteLength(JSON.stringify(p) ?? '', 'utf8') <= MAX_TRIGGER_PAYLOAD_BYTES,
    { message: `Payload must be at most ${MAX_TRIGGER_PAYLOAD_BYTES} bytes.` },
  ),
});

export const ListWebhooksDTO = z.object({
  tenantId: z.string().uuid(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
});

/** Public sort fields → entity properties (phase 43 list contract; this endpoint is 1-based). */
export const WEBHOOK_SORTABLE = {
  name: 'name',
  url: 'url',
  isActive: 'isActive',
  consecutiveFailures: 'consecutiveFailures',
  createdAt: 'createdAt',
  updatedAt: 'updatedAt',
} as const;

export const ListWebhooksQuery = listQuerySchema({
  sortable: WEBHOOK_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageBase: 1,
  filters: { isActive: listFilter.flag(), autoDisabled: listFilter.flag() },
}).extend({
  // The path tenant, validated with the query so a malformed one is a 400 before anything is read.
  tenantId: z.string().uuid(),
});
export type ListWebhooksQuery = z.infer<typeof ListWebhooksQuery>;

/** The delivery columns the deliveries table can sort by. */
export const DELIVERY_SORTABLE = {
  createdAt: 'createdAt',
  status: 'status',
  event: 'event',
  responseStatus: 'responseStatus',
  attempts: 'attempts',
  duration: 'duration',
} as const;

export const ListDeliveriesDTO = listQuerySchema({
  sortable: DELIVERY_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageBase: 1,
  filters: {
    // Optional delivery-listing filters (all AND-combined); `search` matches inside the event name.
    status: listFilter.oneOf(WebhookDeliveryStatusEnum.options),
    event: listFilter.value(),
    createdFrom: listFilter.day(),
    createdTo: listFilter.day(),
    // Instants, kept for API callers that filter by an exact time window.
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  },
}).extend({
  tenantId: z.string().uuid(),
  webhookId: z.string().uuid(),
});

export type CreateWebhookInput = z.infer<typeof CreateWebhookDTO>;
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookDTO>;
export type TriggerWebhookInput = z.infer<typeof TriggerWebhookDTO>;
export type ListWebhooksInput = z.infer<typeof ListWebhooksDTO>;
export type ListDeliveriesInput = z.infer<typeof ListDeliveriesDTO>;
