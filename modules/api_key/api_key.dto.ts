import { z } from 'zod';

export const CreateApiKeyDTO = z.object({
  tenantId: z.string().uuid(),
  name: z.string().min(1).max(128),
  scopes: z.array(z.string()).min(1),
  expiresAt: z.coerce.date().optional(),
});

export const RevokeApiKeyDTO = z.object({
  apiKeyId: z.string().uuid(),
});

export const VerifyApiKeyDTO = z.object({
  key: z.string().min(1),
});

export const ApiKeyIdDTO = z.object({
  apiKeyId: z.string().uuid(),
});

export type CreateApiKeyInput = z.infer<typeof CreateApiKeyDTO>;
export type RevokeApiKeyInput = z.infer<typeof RevokeApiKeyDTO>;
export type VerifyApiKeyInput = z.infer<typeof VerifyApiKeyDTO>;
