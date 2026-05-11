import 'reflect-metadata';
import crypto from 'crypto';
import { AppDataSource } from '@/libs/typeorm';
import { AppError, ErrorCode } from '@/libs/app-error';
import { Logger } from '@/libs/logger';
import { createQueue, getBullMQConnection } from '@/libs/redis';
import { Worker, Job } from 'bullmq';
import { Webhook } from './entities/Webhook';
import { WebhookDelivery } from './entities/WebhookDelivery';
import { WebhookMessages } from './webhook.messages';
import { WebhookSchema, WebhookDeliverySchema } from './webhook.types';
import type { Webhook as WebhookType, WebhookDelivery as WebhookDeliveryType } from './webhook.types';
import type { CreateWebhookInput, UpdateWebhookInput } from './webhook.dto';

interface DeliveryJobData {
  deliveryId: string;
  webhookId: string;
  url: string;
  secret: string;
  event: string;
  payload: Record<string, unknown>;
  requestBody: string;
}

const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [60_000, 300_000, 900_000];
const QUEUE_NAME = 'webhook-delivery-queue';

export default class WebhookService {
  static readonly QUEUE_NAME = QUEUE_NAME;

  static readonly QUEUE = createQueue<DeliveryJobData>(QUEUE_NAME);

  static readonly WORKER = new Worker<DeliveryJobData>(
    QUEUE_NAME,
    async (job: Job<DeliveryJobData>) => {
      await WebhookService.sendDelivery(job.data.deliveryId);
    },
    {
      connection: getBullMQConnection(),
      concurrency: 10,
    },
  );

  private static get webhookRepo() {
    return AppDataSource.getRepository(Webhook);
  }

  private static get deliveryRepo() {
    return AppDataSource.getRepository(WebhookDelivery);
  }

  // ── HMAC signature ────────────────────────────────────────────────────────────

  static sign(payload: string, secret: string): string {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  }

  static getRetryDelay(attempt: number): number {
    return RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────────

  static async create(data: CreateWebhookInput): Promise<WebhookType> {
    const webhook = WebhookService.webhookRepo.create({
      tenantId: data.tenantId,
      url: data.url,
      secret: data.secret,
      events: data.events,
      isActive: true,
    });
    const saved = await WebhookService.webhookRepo.save(webhook);
    return WebhookSchema.parse(saved);
  }

  static async findByTenant(tenantId: string): Promise<WebhookType[]> {
    const webhooks = await WebhookService.webhookRepo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
    return webhooks.map((w) => WebhookSchema.parse(w));
  }

  static async findById(webhookId: string): Promise<WebhookType> {
    const webhook = await WebhookService.webhookRepo.findOne({ where: { webhookId } });
    if (!webhook) {
      throw new AppError(WebhookMessages.WEBHOOK_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    return WebhookSchema.parse(webhook);
  }

  static async update(webhookId: string, data: UpdateWebhookInput): Promise<WebhookType> {
    const webhook = await WebhookService.webhookRepo.findOne({ where: { webhookId } });
    if (!webhook) {
      throw new AppError(WebhookMessages.WEBHOOK_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }

    if (data.url !== undefined) webhook.url = data.url;
    if (data.events !== undefined) webhook.events = data.events;
    if (data.isActive !== undefined) webhook.isActive = data.isActive;

    const saved = await WebhookService.webhookRepo.save(webhook);
    return WebhookSchema.parse(saved);
  }

  static async delete(webhookId: string): Promise<void> {
    const webhook = await WebhookService.webhookRepo.findOne({ where: { webhookId } });
    if (!webhook) {
      throw new AppError(WebhookMessages.WEBHOOK_NOT_FOUND, 404, ErrorCode.NOT_FOUND);
    }
    await WebhookService.webhookRepo.remove(webhook);
  }

  // ── Delivery ──────────────────────────────────────────────────────────────────

  static async deliver(webhookId: string, event: string, payload: unknown): Promise<void> {
    const webhook = await WebhookService.webhookRepo.findOne({ where: { webhookId, isActive: true } });
    if (!webhook) return;

    if (!webhook.events.includes(event)) return;

    const envelope = {
      webhookId: webhook.webhookId,
      tenantId: webhook.tenantId,
      event,
      createdAt: new Date().toISOString(),
      data: payload,
    };
    const requestBody = JSON.stringify(envelope);

    const delivery = WebhookService.deliveryRepo.create({
      webhookId: webhook.webhookId,
      event,
      payload: envelope as Record<string, unknown>,
      status: 'PENDING',
      attemptCount: 0,
    });
    const saved = await WebhookService.deliveryRepo.save(delivery);

    await WebhookService.QUEUE.add(
      'deliver',
      {
        deliveryId: saved.deliveryId,
        webhookId: webhook.webhookId,
        url: webhook.url,
        secret: webhook.secret,
        event,
        payload: envelope as Record<string, unknown>,
        requestBody,
      },
      { attempts: MAX_ATTEMPTS, backoff: { type: 'exponential', delay: 60_000 } },
    );
  }

  static async sendDelivery(deliveryId: string): Promise<void> {
    const delivery = await WebhookService.deliveryRepo.findOne({ where: { deliveryId } });
    if (!delivery) return;

    const webhook = await WebhookService.webhookRepo.findOne({ where: { webhookId: delivery.webhookId } });
    if (!webhook) return;

    const requestBody = JSON.stringify(delivery.payload ?? {});
    const signature = WebhookService.sign(requestBody, webhook.secret);

    let statusCode: number | null = null;
    let responseBody: string | null = null;
    let status: 'SUCCESS' | 'FAILED' = 'FAILED';

    try {
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Event': delivery.event,
          'X-Webhook-Delivery': deliveryId,
          'User-Agent': 'ExpressBoilerplate-Webhooks/1.0',
        },
        body: requestBody,
        signal: AbortSignal.timeout(15_000),
      });

      statusCode = response.status;
      responseBody = (await response.text()).slice(0, 4096);
      status = response.ok ? 'SUCCESS' : 'FAILED';
    } catch (err: unknown) {
      responseBody = err instanceof Error ? err.message : 'Unknown error';
    }

    delivery.status = status;
    delivery.statusCode = statusCode;
    delivery.responseBody = responseBody;
    delivery.attemptCount = delivery.attemptCount + 1;

    if (status === 'FAILED' && delivery.attemptCount < MAX_ATTEMPTS) {
      const delay = WebhookService.getRetryDelay(delivery.attemptCount - 1);
      delivery.nextRetryAt = new Date(Date.now() + delay);
      delivery.status = 'PENDING';
    }

    await WebhookService.deliveryRepo.save(delivery);

    Logger.info(`[Webhook] Delivery ${deliveryId} → ${status} (attempt ${delivery.attemptCount})`);
  }

  static async getDeliveries(webhookId: string): Promise<WebhookDeliveryType[]> {
    const deliveries = await WebhookService.deliveryRepo.find({
      where: { webhookId },
      order: { createdAt: 'DESC' },
    });
    return deliveries.map((d) => WebhookDeliverySchema.parse(d));
  }
}
