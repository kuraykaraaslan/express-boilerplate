import { Not, type FindOptionsWhere } from 'typeorm';
import type { WebhookDelivery as WebhookDeliveryEntity } from './entities/webhook_delivery.entity';

/**
 * The recorded error of a queued delivery whose endpoint was disabled (by an admin or the circuit breaker) before it ran
 * (41-ui-fixes/12 1.6). A stable code, not a sentence: the admin console translates it. Such a row was never sent, so the
 * metrics count it as its own outcome, not as a failure (41-ui-fixes/12 3.6, 4.3). Here, not in webhook.job-resolve.ts,
 * so the read side can use it without loading the worker's dependencies.
 */
export const WEBHOOK_ENDPOINT_DISABLED = 'ENDPOINT_DISABLED';

/** The statuses a manual redeliver or replay may claim (41-ui-fixes/12 1.4, 1.5). */
export const REDELIVERABLE_STATUSES = ['FAILED', 'DEAD_LETTERED'] as const;

/**
 * The dead letters "Replay" re-sends (webhook.redeliver.service.ts), and the ones the count the console shows before
 * confirming is made of (`WebhookMetricsService.getEndpointReliability().deadLetteredCount`): every DEAD_LETTERED delivery
 * of the endpoint, with no time window, except test sends (41-ui-fixes/12 1.4). One definition, so the count and the
 * replay cannot disagree.
 */
export function replayableDeadLetterWhere(tenantId: string, webhookId: string): FindOptionsWhere<WebhookDeliveryEntity> {
  return { tenantId, webhookId, status: 'DEAD_LETTERED', event: Not('test') };
}
