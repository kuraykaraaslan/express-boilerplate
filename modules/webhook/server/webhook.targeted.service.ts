import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import type { WebhookEvent } from './webhook.enums';
import { hasWebhookFeature } from './webhook.dispatch.service';
import { passesEventFilter } from './webhook.filters';
import { enqueueDelivery } from './webhook.queue';

/**
 * One signed, retried, dead-lettered delivery to ONE endpoint of the tenant (automation's `action.webhook`, phase 08/05 §5.21).
 * Not `dispatchEvent`: that reaches every subscriber, drops silently on a plan downgrade and notifies the event sinks (which
 * would let a flow trigger itself through its own node). The caller's `idempotencyKey` makes a retried call one delivery and
 * travels to the receiver as `X-Idempotency-Key`. Consent stays with the endpoint: it must be active and subscribed to the event.
 */
export type TargetedFailure = 'plan' | 'endpoint_not_found' | 'endpoint_inactive' | 'not_subscribed' | 'enqueue_failed';
export type TargetedResult = { ok: true; deliveryId: string } | { ok: false; error: TargetedFailure };

export async function deliverToEndpoint(
  tenantId: string,
  webhookId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  opts: { idempotencyKey?: string } = {},
): Promise<TargetedResult> {
  if (!(await hasWebhookFeature(tenantId))) return { ok: false, error: 'plan' };
  try {
    const webhook = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo.findOne({ where: { tenantId, webhookId } }));
    if (!webhook) return { ok: false, error: 'endpoint_not_found' };
    if (!webhook.isActive) return { ok: false, error: 'endpoint_inactive' };
    if (!webhook.events.includes(event) || !passesEventFilter(webhook, event, payload)) return { ok: false, error: 'not_subscribed' };
    return { ok: true, deliveryId: await enqueueDelivery(webhook, event, payload, opts) };
  } catch (err) {
    Logger.error(`[Webhook] deliverToEndpoint failed for tenant=${tenantId} webhook=${webhookId}: ${err}`);
    return { ok: false, error: 'enqueue_failed' };
  }
}

export type NamedTargetedFailure = TargetedFailure | 'endpoint_ambiguous';

/**
 * integrations_hub.03: the same targeted delivery, addressed by the endpoint's NAME (what an integration configuration
 * stores), not by its id. The name must identify exactly one endpoint of the tenant: two endpoints with that name answer
 * `endpoint_ambiguous` and nothing is sent (never "the first one"). Everything else is `deliverToEndpoint`: plan,
 * active, subscribed, signed, retried, `idempotencyKey` deduplicated.
 */
export async function deliverToNamedEndpoint(
  tenantId: string,
  endpointName: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  opts: { idempotencyKey?: string } = {},
): Promise<{ ok: true; deliveryId: string; webhookId: string } | { ok: false; error: NamedTargetedFailure }> {
  let matches: Array<{ webhookId: string }>;
  try {
    matches = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) =>
      repo.find({ where: { tenantId, name: endpointName }, select: { webhookId: true }, take: 2 }));
  } catch (err) {
    Logger.error(`[Webhook] deliverToNamedEndpoint lookup failed for tenant=${tenantId}: ${err}`);
    return { ok: false, error: 'enqueue_failed' };
  }
  if (matches.length === 0) return { ok: false, error: 'endpoint_not_found' };
  if (matches.length > 1) return { ok: false, error: 'endpoint_ambiguous' };
  const result = await deliverToEndpoint(tenantId, matches[0]!.webhookId, event, payload, opts);
  return result.ok ? { ...result, webhookId: matches[0]!.webhookId } : result;
}
