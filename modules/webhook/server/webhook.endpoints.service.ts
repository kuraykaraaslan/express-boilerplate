import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import type { WebhookEvent } from './webhook.enums';

/**
 * Kept apart from `webhook.targeted.service` on purpose: that one reaches `webhook.queue`, which starts a BullMQ worker when it
 * is imported, and a picker served from a web process must not start one.
 */
/** The active endpoints of a tenant subscribed to `event`, for a picker: id, url host and name (never a secret or a header). */
export async function listSubscribedEndpoints(tenantId: string, event: WebhookEvent): Promise<Array<{ webhookId: string; label: string }>> {
  const rows = await withTenantRepositoryFor(tenantId, WebhookEntity, (repo) => repo.find({ where: { tenantId, isActive: true } }));
  return rows
    .filter((w) => w.events.includes(event))
    .map((w) => {
      let host = '';
      try { host = new URL(w.url).host; } catch { /* a stored url is validated; this is a label only */ }
      return { webhookId: w.webhookId, label: [w.name, host].filter(Boolean).join(' · ') || w.webhookId };
    });
}
