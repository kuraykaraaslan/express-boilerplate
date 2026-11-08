import 'reflect-metadata';
import { withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { Webhook } from './entities/webhook.entity';
import { WebhookDelivery } from './entities/webhook_delivery.entity';

/** Deliveries are high-volume; the endpoints they belong to are not. */
const DELIVERY_CAP = 5000;

/**
 * `tenant_export:collection` — webhook endpoints and their recent deliveries.
 *
 * Handed over from `tenant_export`'s hand-written list (DEP-04). `secret` and
 * the rotation slot `previousSecret` are stripped here: each is an HMAC key a
 * receiver verifies signatures with (the previous one for the whole overlap
 * window), so exporting either would let anyone holding the file forge this
 * tenant's webhooks. Both are field-encrypted at rest, so the repository hands
 * them over decrypted; dropping them is what keeps them out of the file.
 *
 * Deliveries keep the same cap and newest-first order the built-in collector
 * used — a truncated delivery log is only useful if it is the recent end of it.
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  // One block, sequential reads (a block is one connection).
  const [webhooks, deliveries] = await withTenantTransactionFor(tenantId, async (qr) => [
    await qr.manager.getRepository(Webhook).find({ where: { tenantId } }),
    await qr.manager.getRepository(WebhookDelivery).find({
      where: { tenantId }, order: { createdAt: 'DESC' }, take: DELIVERY_CAP,
    }),
  ] as const);
  const safeWebhooks = webhooks.map(({ secret: _secret, previousSecret: _previousSecret, ...rest }) => rest);
  return [
    { key: 'webhooks', label: 'Webhook endpoints', rows: safeWebhooks },
    { key: 'webhookDeliveries', label: 'Webhook deliveries', rows: deliveries },
  ];
};

export default provider;
