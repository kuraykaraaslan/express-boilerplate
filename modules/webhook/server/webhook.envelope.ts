/**
 * The body of an outbound webhook (work order 2 item 8, decision D-OBS-11): either the platform's own envelope (the default, unchanged) or, per
 * subscription (`format: 'cloudevents'`), a CloudEvents 1.0 event in STRUCTURED content mode.
 *
 * CloudEvents 1.0 (https://github.com/cloudevents/spec/blob/v1.0.2/cloudevents/spec.md, JSON format in formats/json-format.md):
 *   REQUIRED  `specversion` ("1.0"), `id` (non-empty string, unique per `source`), `source` (non-empty URI-reference), `type` (non-empty string).
 *   OPTIONAL  `datacontenttype` (RFC 2046 media type of `data`), `dataschema`, `subject`, `time` (RFC 3339 timestamp), `data`.
 *   Extension attributes: names of 1 to 20 lowercase letters and digits; here `tenantid` and `webhookid` (JSON strings).
 *   Structured mode: the whole event is the HTTP body, `Content-Type: application/cloudevents+json; charset=utf-8`.
 *
 * Choices: `type` is the platform event name under a reverse-DNS prefix (`dev.kuray.nb.` + `incident.opened`); `source` is `urn:nb:tenant:<tenantId>`
 * (the context that produced the event, stable across retries); `id` is generated once per event and lives in the stored request body, so a retry or
 * a manual redelivery carries the SAME id (CloudEvents consumers deduplicate on source + id). `data` is the platform payload as it always was, so a
 * consumer that switches formats finds the same fields under `data`. Signatures and `X-Webhook-*` headers are identical in both formats and are
 * computed over the body that is sent.
 */
import { randomUUID } from 'node:crypto';

export const WEBHOOK_FORMATS = ['json', 'cloudevents'] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const CLOUDEVENTS_SPECVERSION = '1.0';
export const CLOUDEVENTS_TYPE_PREFIX = 'dev.kuray.nb.';
export const CLOUDEVENTS_CONTENT_TYPE = 'application/cloudevents+json; charset=utf-8';
export const JSON_CONTENT_TYPE = 'application/json';

export const cloudEventsSource = (tenantId: string): string => `urn:nb:tenant:${tenantId}`;

/**
 * `manual`: an admin sent this event by hand (the trigger action), so its `data` is an admin-written sample, not something that happened
 * (41-ui-fixes/12 2.1, decision d). The body then carries `manual: true` (a top-level member of the platform envelope, an extension attribute of a
 * CloudEvent) and the request the `X-Webhook-Manual: true` header; both are covered by the signature, since the body is what is signed. A
 * dispatched event leaves it out, so its bytes are unchanged.
 */
export interface EnvelopeInput { webhookId: string; tenantId: string; event: string; payload: Record<string, unknown>; now?: Date; id?: string; manual?: boolean }

export interface CloudEvent {
  specversion: '1.0';
  id: string;
  source: string;
  type: string;
  datacontenttype: 'application/json';
  time: string;
  data: Record<string, unknown>;
  tenantid: string;
  webhookid: string;
  /** Present (true) only on an event an admin triggered by hand (41-ui-fixes/12 2.1). */
  manual?: true;
}

/** The platform's own envelope: what has always been sent. */
export function platformEnvelope(i: EnvelopeInput): Record<string, unknown> {
  return {
    webhookId: i.webhookId, tenantId: i.tenantId, event: i.event, createdAt: (i.now ?? new Date()).toISOString(), data: i.payload,
    ...(i.manual && { manual: true }),
  };
}

export function cloudEventOf(i: EnvelopeInput): CloudEvent {
  return {
    specversion: CLOUDEVENTS_SPECVERSION, id: i.id ?? randomUUID(), source: cloudEventsSource(i.tenantId), type: `${CLOUDEVENTS_TYPE_PREFIX}${i.event}`,
    datacontenttype: 'application/json', time: (i.now ?? new Date()).toISOString(), data: i.payload, tenantid: i.tenantId, webhookid: i.webhookId,
    ...(i.manual && { manual: true as const }),
  };
}

export function buildEnvelope(format: WebhookFormat | null | undefined, i: EnvelopeInput): { envelope: Record<string, unknown>; contentType: string } {
  return format === 'cloudevents'
    ? { envelope: cloudEventOf(i) as unknown as Record<string, unknown>, contentType: CLOUDEVENTS_CONTENT_TYPE }
    : { envelope: platformEnvelope(i), contentType: JSON_CONTENT_TYPE };
}

/**
 * The Content-Type a stored body must be re-sent with (a redelivery re-sends the stored body, whatever the subscription's format is now):
 * a CloudEvents body says so with its first member.
 */
export function contentTypeOfBody(requestBody: string): string {
  return /^\{"specversion":"1\.0"/.test(requestBody) ? CLOUDEVENTS_CONTENT_TYPE : JSON_CONTENT_TYPE;
}

/**
 * Was this stored body sent by hand (41-ui-fixes/12 2.1)? Read from the body itself, so a retry, a redelivery or a job queued by an older build
 * carries the same `X-Webhook-Manual` header as the first attempt. Only the envelope's own top-level member counts, never one inside `data`.
 */
export function isManualBody(requestBody: string): boolean {
  try {
    const parsed = JSON.parse(requestBody) as unknown;
    return !!parsed && typeof parsed === 'object' && (parsed as { manual?: unknown }).manual === true;
  } catch {
    return false;
  }
}
