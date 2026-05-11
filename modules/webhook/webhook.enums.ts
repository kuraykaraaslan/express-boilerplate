import { z } from 'zod';

export const WebhookDeliveryStatusEnum = z.enum(['PENDING', 'SUCCESS', 'FAILED']);

export type WebhookDeliveryStatus = z.infer<typeof WebhookDeliveryStatusEnum>;
