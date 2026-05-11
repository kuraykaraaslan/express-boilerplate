import { z } from 'zod';
import { WebhookDeliveryStatusEnum } from './webhook.enums';

export const WebhookSchema = z.object({
  webhookId: z.string().uuid(),
  tenantId: z.string(),
  url: z.string().url(),
  secret: z.string(),
  events: z.array(z.string()),
  isActive: z.boolean().default(true),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export const WebhookDeliverySchema = z.object({
  deliveryId: z.string().uuid(),
  webhookId: z.string(),
  event: z.string(),
  payload: z.record(z.unknown()).nullable(),
  status: WebhookDeliveryStatusEnum,
  statusCode: z.number().nullable().optional(),
  responseBody: z.string().nullable().optional(),
  attemptCount: z.number().default(0),
  nextRetryAt: z.date().nullable().optional(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export type Webhook = z.infer<typeof WebhookSchema>;
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
