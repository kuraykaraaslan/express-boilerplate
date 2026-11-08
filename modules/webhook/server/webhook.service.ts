import 'reflect-metadata';
import type { WebhookDelivery, WebhookDeliveryListRow, WebhookMetrics, WebhookReport } from './webhook.types';
import type { ListDeliveriesInput } from './webhook.dto';
import type { WebhookEvent } from './webhook.enums';
import { signPayload, generateSecret } from './webhook.crypto';
import { webhookQueue } from './webhook.queue';
import { dispatchEvent, dispatchPlatformEvent } from './webhook.dispatch.service';
import { redeliver, replayDeadLettered, sendTest, triggerEvent } from './webhook.redeliver.service';
import WebhookMetricsService from './webhook.metrics.service';

/**
 * Public coordinator for the webhook subsystem: endpoint CRUD, event dispatch,
 * secret rotation, manual (re)delivery, and reporting. The heavy machinery is
 * delegated to focused collaborators — billing-gated dispatch
 * (`webhook.dispatch.service`), manual redeliver/replay/test/trigger
 * (`webhook.redeliver.service`), HTTP delivery + circuit breaker
 * (`WebhookDeliveryService`), the BullMQ producer/worker (`webhook.queue.ts`),
 * delivery tuning (`webhook.config.ts`), reporting (`WebhookMetricsService`),
 * payload filters (`webhook.filters.ts`) and signing (`webhook.crypto.ts`).
 */
export default class WebhookService {
  /** Shared producer handle (the queue + worker live in `webhook.queue.ts`). */
  static readonly QUEUE = webhookQueue;

  static signPayload(secret: string, body: string): string {
    return signPayload(secret, body);
  }

  static generateSecret(): string {
    return generateSecret();
  }

  static dispatchEvent(
    tenantId: string,
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return dispatchEvent(tenantId, event, payload);
  }

  static dispatchPlatformEvent(
    event: WebhookEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    return dispatchPlatformEvent(event, payload);
  }

  /** `actorId`: the caller, named by the audit row (41-ui-fixes/12 2.1); the same for the other manual sends below. */
  static redeliver(tenantId: string, webhookId: string, deliveryId: string, actorId: string | null = null): Promise<void> {
    return redeliver(tenantId, webhookId, deliveryId, actorId);
  }

  static replayDeadLettered(tenantId: string, webhookId: string, actorId: string | null = null): Promise<{ replayed: number; skipped: number }> {
    return replayDeadLettered(tenantId, webhookId, actorId);
  }

  /** What {@link replayDeadLettered} would re-send now (41-ui-fixes/12 1.4): the count the replay's confirm shows. */
  static countReplayableDeadLetters(tenantId: string, webhookId: string): Promise<number> {
    return WebhookMetricsService.countReplayableDeadLetters(tenantId, webhookId);
  }

  static sendTest(tenantId: string, webhookId: string, actorId: string | null = null): Promise<WebhookDelivery> {
    return sendTest(tenantId, webhookId, actorId);
  }

  static triggerEvent(
    tenantId: string,
    webhookId: string,
    event: WebhookEvent,
    samplePayload: Record<string, unknown> = {},
    actorId: string | null = null,
  ): Promise<string> {
    return triggerEvent(tenantId, webhookId, event, samplePayload, actorId);
  }

  static listDeliveries(input: ListDeliveriesInput): Promise<{ deliveries: WebhookDeliveryListRow[]; total: number }> {
    return WebhookMetricsService.listDeliveries(input);
  }

  static getMetrics(
    tenantId: string,
    opts: { webhookId?: string; since?: Date } = {},
  ): Promise<WebhookMetrics> {
    return WebhookMetricsService.getMetrics(tenantId, opts);
  }

  static getReport(
    tenantId: string,
    opts: { webhookId?: string; since?: Date } = {},
  ): Promise<WebhookReport> {
    return WebhookMetricsService.getReport(tenantId, opts);
  }
}
