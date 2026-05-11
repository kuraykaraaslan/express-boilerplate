import { z } from 'zod';

export const CreateWebhookDTO = z.object({
  tenantId: z.string().uuid(),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  secret: z.string().min(16),
});

export const UpdateWebhookDTO = z.object({
  url: z.string().url().optional(),
  events: z.array(z.string()).optional(),
  isActive: z.boolean().optional(),
});

export const TriggerWebhookDTO = z.object({
  event: z.string(),
  payload: z.record(z.unknown()),
});

export const WebhookIdDTO = z.object({
  webhookId: z.string().uuid(),
});

export type CreateWebhookInput = z.infer<typeof CreateWebhookDTO>;
export type UpdateWebhookInput = z.infer<typeof UpdateWebhookDTO>;
export type TriggerWebhookInput = z.infer<typeof TriggerWebhookDTO>;
