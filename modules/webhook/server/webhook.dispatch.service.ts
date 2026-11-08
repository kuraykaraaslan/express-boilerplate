import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import type { WebhookEvent } from './webhook.enums';
import Logger from '@kuraykaraaslan-labs/logger';
import FeatureGateService from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.service';
import { FEATURE_KEYS } from '@kuraykaraaslan-labs/feature_gate/server/feature_gate.keys';
import { isRootTenant, ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { passesEventFilter } from './webhook.filters';
import { enqueueDelivery } from './webhook.queue';
import { notifyEventSinks, type WebhookEventMeta } from './webhook.event-sink';
import { isDeclaredWebhookEvent } from './webhook.catalog';

/**
 * Defense-in-depth billing gate for webhooks. Tenants without the
 * `feature_webhooks` BOOLEAN feature on their active plan are skipped
 * silently — no enqueue, no audit row. Root tenant is short-circuited.
 *
 * Uses checkFeatureAccess (not assert) because dispatchEvent is called
 * from many event producers and must never propagate a 402 to a
 * non-billing code path.
 */
export async function hasWebhookFeature(tenantId: string): Promise<boolean> {
  if (isRootTenant(tenantId)) return true;
  try {
    const result = await FeatureGateService.checkFeatureAccess(
      tenantId,
      FEATURE_KEYS.FEATURE_WEBHOOKS,
    );
    return result.allowed;
  } catch (err) {
    Logger.warn(
      `[Webhook] hasWebhookFeature check failed for tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export async function dispatchEvent(
  tenantId: string,
  event: WebhookEvent,
  payload: Record<string, unknown>,
  /** Optional, additive: sinks only (never the webhook payload). */
  meta?: WebhookEventMeta,
): Promise<void> {
  // Sinks first and never awaited: a slow, broken or missing sink must not delay or fail the dispatch, and a tenant
  // without the webhook plan feature still reaches its automation flows.
  notifyEventSinks(tenantId, event, payload, meta);
  try {
    // Nobody can subscribe to an undeclared event, so it has no endpoints: log the emitter's missing declaration once
    // (`webhook:event_type`) and skip the endpoint lookup.
    if (!(await isDeclaredWebhookEvent(event))) return;

    // Skip enqueue entirely when the tenant plan does not include webhooks.
    // Best-effort billing: a plan downgrade between dispatch and worker pick
    // is still caught at delivery time by the same check, but is
    // intentionally not atomic.
    if (!(await hasWebhookFeature(tenantId))) {
      return;
    }

    // The swallowing catch below wraps this block; each enqueue writes its
    // delivery row in a block of its own (docs/phases/10-db Faz 3).
    const webhooks = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo.find({
      where: { tenantId, isActive: true },
    }));

    const matching = webhooks.filter(
      (w) => w.events.includes(event) && passesEventFilter(w, event, payload),
    );
    await Promise.all(matching.map((w) => enqueueDelivery(w, event, payload)));
  } catch (err) {
    Logger.error(`[Webhook] dispatchEvent failed for tenant=${tenantId} event=${event}: ${err}`);
  }
}

/**
 * Dispatch a platform-wide event (user.*, tenant.*, plan.*, subscription.assigned)
 * to root-tenant webhooks. Thin wrapper over {@link dispatchEvent} pinned to
 * {@link ROOT_TENANT_ID} — platform producers call this instead of threading the
 * root tenant id through every call site. Fire-and-forget; never throws.
 */
export async function dispatchPlatformEvent(
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  return dispatchEvent(ROOT_TENANT_ID, event, payload);
}
