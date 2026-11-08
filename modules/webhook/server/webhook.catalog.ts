import { z } from 'zod';
import { ext, systemCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext';
import { WebhookEventNameSchema, type WebhookEvent } from './webhook.enums';

/**
 * The webhook event catalog: scope, UI grouping, label and description of every event the INSTALLED modules declare.
 * Both the admin event picker and `GET /tenant/[id]/api/webhooks/events` read it, as do the create, update and trigger
 * checks.
 *
 * It used to be a closed enum plus a `Record<WebhookEvent, …>` here, so every module's events (and every new module's)
 * were an edit of this module. A module now declares its own events through the `webhook:event_type` point, one
 * contribution per event, with the event name as the key and the description in the static `metadata` (no code is
 * loaded to build the catalog):
 *
 * ```json
 * { "point": "webhook:event_type", "key": "order.created", "export": "commerce_order/server/commerce_order.webhook-events",
 *   "metadata": { "scope": "tenant", "group": "Sales Orders", "label": "Order created", "description": "A sales order was placed." } }
 * ```
 *
 * Two modules may declare the same event (a subscription event is emitted by both payment_subscription and
 * tenant_subscription); the first by order is kept, and a declaration that disagrees on the scope is dropped with a
 * warning, because the scope decides which tenants may subscribe.
 */

export const WEBHOOK_EVENT_TYPE_POINT = 'webhook:event_type';

export type WebhookEventScope = 'tenant' | 'platform';

export const WebhookEventMetaSchema = z.object({
  /** Which webhooks receive this event: a regular tenant's, or the root/platform tenant's. */
  scope: z.enum(['tenant', 'platform']),
  /** UI grouping label for the event picker. */
  group: z.string().min(1).max(60),
  /** Short human label. */
  label: z.string().min(1).max(120),
  /** One-line description of when the event fires. */
  description: z.string().min(1).max(500),
});
export type WebhookEventMeta = z.infer<typeof WebhookEventMetaSchema>;

export interface WebhookEventCatalogEntry extends WebhookEventMeta {
  event: WebhookEvent;
}

let cache: Promise<Map<string, WebhookEventMeta>> | null = null;
const warnedUnknown = new Set<string>();

async function warn(message: string): Promise<void> {
  const { default: Logger } = await import('@kuraykaraaslan-labs/logger');
  Logger.warn(message);
}

/** A process-wide catalog (a system context): the events this build declares, whatever any tenant has switched on. */
async function build(): Promise<Map<string, WebhookEventMeta>> {
  const map = new Map<string, WebhookEventMeta>();
  for (const c of await ext.contributions(WEBHOOK_EVENT_TYPE_POINT, systemCtx('process-wide webhook event catalog'))) {
    const name = WebhookEventNameSchema.safeParse(c.key);
    const meta = WebhookEventMetaSchema.safeParse(c.metadata);
    if (!name.success || !meta.success) {
      await warn(`[webhook] ignoring malformed event declaration '${c.key}' from '${c.moduleId}'`);
      continue;
    }
    const existing = map.get(name.data);
    if (existing) {
      if (existing.scope !== meta.data.scope) {
        await warn(`[webhook] event '${name.data}' from '${c.moduleId}' is declared with scope '${meta.data.scope}', another module declared '${existing.scope}'; ignored`);
      }
      continue;
    }
    map.set(name.data, meta.data);
  }
  return map;
}

/** Every declared event, resolved once per process (a failed read is retried on the next call). */
export function getWebhookEventCatalog(): Promise<Map<string, WebhookEventMeta>> {
  cache ??= build().catch((error: unknown) => { cache = null; throw error; });
  return cache;
}

/** Flat list of every catalog entry, in declaration order. */
export async function catalogEntries(): Promise<WebhookEventCatalogEntry[]> {
  return [...(await getWebhookEventCatalog())].map(([event, meta]) => ({ event, ...meta }));
}

/** Catalog entries visible to a given scope. */
export async function catalogForScope(scope: WebhookEventScope): Promise<WebhookEventCatalogEntry[]> {
  return (await catalogEntries()).filter((e) => e.scope === scope);
}

/**
 * Catalog entries for a scope, grouped for the UI picker. Groups appear in
 * first-seen declaration order; events keep their declaration order within a group.
 */
export async function groupedCatalogForScope(
  scope: WebhookEventScope,
): Promise<{ group: string; events: WebhookEventCatalogEntry[] }[]> {
  const groups: { group: string; events: WebhookEventCatalogEntry[] }[] = [];
  const byName = new Map<string, WebhookEventCatalogEntry[]>();
  for (const entry of await catalogForScope(scope)) {
    let bucket = byName.get(entry.group);
    if (!bucket) {
      bucket = [];
      byName.set(entry.group, bucket);
      groups.push({ group: entry.group, events: bucket });
    }
    bucket.push(entry);
  }
  return groups;
}

/** Resolve the scope for a tenant id: the root tenant sees platform events. */
export function scopeForTenant(isRoot: boolean): WebhookEventScope {
  return isRoot ? 'platform' : 'tenant';
}

/** The names in `events` that no installed module declares for `scope` (empty when all are subscribable). */
export async function undeclaredEvents(events: readonly string[], scope: WebhookEventScope): Promise<string[]> {
  const catalog = await getWebhookEventCatalog();
  return events.filter((e) => catalog.get(e)?.scope !== scope);
}

/**
 * Dispatch-path check: is `event` declared? An undeclared event is logged once per process (it has no subscribers, since
 * nobody can subscribe to it, so the emitter almost certainly forgot its declaration); the dispatch itself goes on, so
 * event sinks still hear it. A catalog that cannot be read counts as declared, so a registry failure never drops deliveries.
 */
export async function isDeclaredWebhookEvent(event: string): Promise<boolean> {
  const catalog = await getWebhookEventCatalog().catch(() => null);
  if (!catalog || catalog.has(event)) return true;
  if (!warnedUnknown.has(event)) {
    warnedUnknown.add(event);
    await warn(`[webhook] event '${event}' is dispatched but no installed module declares it (declare it via '${WEBHOOK_EVENT_TYPE_POINT}')`);
  }
  return false;
}

/** Test seam: replace (or clear, with `null`) the per-process catalog. */
export function __setWebhookEventCatalogForTests(entries: WebhookEventCatalogEntry[] | null): void {
  warnedUnknown.clear();
  if (entries === null) { cache = null; return; }
  cache = Promise.resolve(new Map(entries.map(({ event, ...meta }) => [event, meta])));
}
