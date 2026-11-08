import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { webhookEventSinkLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/webhook.event_sink';

/** Extension point id, declared in webhook/module.json `extensionPoints`. */
export const WEBHOOK_EVENT_SINK_POINT = 'webhook:event_sink';

/** Optional actor of a dispatched event (additive: call sites that pass none are unchanged). Only the id travels. */
export interface WebhookEventMeta {
  actor?: { type: string; id: string };
}

/**
 * A module that wants to hear every dispatched domain event.
 *
 * `names` narrows the subscription; a sink without it hears everything, which is worth having to say out loud.
 */
export interface WebhookEventSink {
  key?: string;
  names?: string[];
  onEvent(tenantId: string, event: string, payload: Record<string, unknown>, meta?: WebhookEventMeta): Promise<void> | void;
}

/**
 * Tell the sinks, and never let them affect the dispatch.
 *
 * `dispatchEvent` sits on the request path of ~50 modules, so this is fire-and-forget by construction: a detached
 * fan-out (the caller does not wait for it), it runs before the webhook plan gate (a tenant without
 * `feature_webhooks` still reaches its flows; the sink applies its own plan gate), only sinks of modules active for
 * the tenant hear the event, every sink is isolated, and a throw — or a stale snapshot — is logged and dropped.
 */
export function notifyEventSinks(
  tenantId: string,
  event: string,
  payload: Record<string, unknown>,
  meta?: WebhookEventMeta,
): void {
  void ext.fanOut<WebhookEventSink>(
    WEBHOOK_EVENT_SINK_POINT, tenantCtx(tenantId), webhookEventSinkLoaders,
    async (sink) => {
      if (sink.names?.length && !sink.names.includes(event)) return;
      await sink.onEvent(tenantId, event, payload, meta);
    },
    { detached: true },
  );
}
