import { z } from 'zod';

export const ApiKeySchema = z.object({
  apiKeyId: z.string().uuid(),
  tenantId: z.string(),
  name: z.string(),
  keyHash: z.string(),
  keyPrefix: z.string(),
  scopes: z.array(z.string()),
  isActive: z.boolean().default(true),
  expiresAt: z.date().nullable().optional(),
  lastUsedAt: z.date().nullable().optional(),
  createdAt: z.date().nullable(),
  updatedAt: z.date().nullable(),
});

export const SafeApiKeySchema = ApiKeySchema.omit({ keyHash: true });

export type ApiKey = z.infer<typeof ApiKeySchema>;
export type SafeApiKey = z.infer<typeof SafeApiKeySchema>;

export interface CreateApiKeyResult {
  apiKey: SafeApiKey;
  rawKey: string;
}
