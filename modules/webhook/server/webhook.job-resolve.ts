import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import Logger from '@kuraykaraaslan-labs/logger';
import { Webhook as WebhookEntity } from './entities/webhook.entity';
import { WebhookDelivery as WebhookDeliveryEntity } from './entities/webhook_delivery.entity';
import { toWebhookJobData, type DeliveryJobData, type WebhookJobData } from './webhook.config';
import { openWebhookSecrets } from './webhook.secrets';
import { WEBHOOK_ENDPOINT_DISABLED } from './webhook.dead-letters';

/** The rotation-overlap previous secret is used only while its window runs. */
export function previousSecretInWindow(webhook: { previousSecretExpiresAt?: Date | null }, now = new Date()): boolean {
  return !!webhook.previousSecretExpiresAt && webhook.previousSecretExpiresAt > now;
}

/** The recorded error of a queued delivery whose endpoint was deleted before it ran. */
export const WEBHOOK_ENDPOINT_GONE = 'the webhook endpoint no longer exists';

export { WEBHOOK_ENDPOINT_DISABLED };

/**
 * Whether a job belongs to the row's current claim (41-ui-fixes/12 1.5): every enqueue and every redeliver / replay claim
 * writes a fresh `claimId` on the row and puts the same id in its job. A job of an earlier claim (a stale retry or a
 * deferred job of a row that was redelivered since) no longer matches and must not send. A job of an older build carries
 * none, and neither does a row written before the column existed: those two still match each other, so a legacy job
 * of a legacy row that was never claimed again is sent as before.
 */
export function jobMatchesClaim(row: { claimId?: string | null }, job: { claimId?: string }): boolean {
  return (row.claimId ?? null) === (job.claimId ?? null);
}

/**
 * The worker side of P9-5: re-loads the endpoint by id under the job's tenant and opens its secrets now, so nothing secret
 * ever sat in Redis. Fields an older build put in the job (secret, previousSecret, url, headers, ipAllowlist) are ignored.
 * An endpoint deleted since the enqueue resolves to null: the job ends without sending and its delivery row, if any is
 * left, is dead-lettered with a reason. A delivery row that is already SUCCESS or DEAD_LETTERED resolves to null too (D252: a second
 * job of one delivery, the pending sweep's re-enqueue of a row whose first job it could not see, never sends twice).
 *
 * 41-ui-fixes/12 1.4-1.6 (decision c): a job sends only for a delivery row that is still PENDING under the job's own
 * claim (`jobMatchesClaim`), of an endpoint that is still active. Anything else resolves to null and nothing is sent:
 *   - no row, or a row that is no longer PENDING (already delivered, or claimed and finished by another job): left alone;
 *   - a row claimed again since this job was queued (its `claimId` is another job's, 1.5): left alone, even when it is
 *     PENDING again, so a stale retry never sends next to the job of the new claim;
 *   - an endpoint disabled since the enqueue (the circuit breaker tripped, or an admin turned it off): the row is
 *     DEAD_LETTERED with `errorMessage = 'ENDPOINT_DISABLED'`, so retries, deferred and redelivered jobs already in the
 *     queue stop with the endpoint, and after it is re-enabled the row can be redelivered or replayed with the other dead
 *     letters. The circuit breaker is not touched (nothing was sent).
 */
export async function resolveDeliveryJob(data: WebhookJobData): Promise<DeliveryJobData | null> {
  const job = toWebhookJobData(data);
  const webhook = await withTenantRepositoryFor(job.tenantId, WebhookEntity, (repo) =>
    repo.findOne({ where: { webhookId: job.webhookId, tenantId: job.tenantId } }));
  if (!webhook) {
    await withTenantRepositoryFor(job.tenantId, WebhookDeliveryEntity, async (repo) => {
      const row = await repo.findOne({ where: { tenantId: job.tenantId, deliveryId: job.deliveryId } });
      if (!row || row.status === 'SUCCESS' || row.status === 'DEAD_LETTERED' || !jobMatchesClaim(row, job)) return;
      row.status = 'DEAD_LETTERED';
      row.nextRetryAt = null;
      row.errorMessage = WEBHOOK_ENDPOINT_GONE;
      await repo.save(row);
    });
    Logger.warn(`[Webhook] delivery ${job.deliveryId} dropped: endpoint ${job.webhookId} no longer exists (tenant=${job.tenantId})`);
    return null;
  }
  const sendable = await withTenantRepositoryFor(job.tenantId, WebhookDeliveryEntity, async (repo) => {
    const row = await repo.findOne({ where: { tenantId: job.tenantId, deliveryId: job.deliveryId, webhookId: job.webhookId } });
    if (!row || row.status !== 'PENDING') return { ok: false as const, why: row ? `status ${row.status}` : 'no delivery row' };
    // (41-ui-fixes/12 1.5) a job of an earlier claim: the row is someone else's now; nothing is sent and the row is left
    if (!jobMatchesClaim(row, job)) return { ok: false as const, why: 'superseded by a newer claim' };
    if (webhook.isActive === false) {
      row.status = 'DEAD_LETTERED';
      row.nextRetryAt = null;
      row.errorMessage = WEBHOOK_ENDPOINT_DISABLED;
      await repo.save(row);
      return { ok: false as const, why: 'endpoint disabled' };
    }
    return { ok: true as const };
  });
  if (!sendable.ok) {
    Logger.warn(`[Webhook] delivery ${job.deliveryId} not sent (${sendable.why}; webhook=${job.webhookId} tenant=${job.tenantId})`);
    return null;
  }
  const { secret, previousSecret } = await openWebhookSecrets(webhook, { withPrevious: previousSecretInWindow(webhook) });
  return {
    ...job,
    url: webhook.url,
    secret,
    previousSecret,
    headers: webhook.headers,
    ipAllowlist: webhook.ipAllowlist,
  };
}
