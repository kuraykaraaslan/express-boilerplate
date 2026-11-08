import { z } from 'zod';

/**
 * Webhook event names. There is no closed list here: every module declares the events it emits through the
 * `webhook:event_type` point (its module.json carries each event's scope, group, label and description, and a
 * `<module>.webhook-events.ts` file lists the names for its emit sites), and `webhook.catalog.ts` builds the catalog of
 * the installed modules from those declarations. A module that is not installed declares nothing, so its events
 * cannot be subscribed to; a new module (an IoT one, say) adds events without touching this module.
 *
 * The root (platform) tenant subscribes to the platform-scope events (user.*, tenant.*, plan.*) through Webhook rows
 * tagged with ROOT_TENANT_ID, exactly as a normal tenant subscribes to `member.created`.
 *
 * This schema checks the SHAPE of a name only (lower-case dotted segments); whether it is declared is checked against
 * the catalog where a webhook is created, updated or triggered.
 */
export const WebhookEventNameSchema = z.string().max(100).regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/, {
  message: 'Event names are lower-case dotted segments, e.g. order.created',
});

/** A webhook event name, declared by some module through `webhook:event_type`. */
export type WebhookEvent = string;

// ─── Shared ───────────────────────────────────────────────────────────────────

export const WebhookDeliveryStatusEnum = z.enum(['PENDING', 'SUCCESS', 'FAILED', 'DEAD_LETTERED']);
export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusEnum>;
