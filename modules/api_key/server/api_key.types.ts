import { z } from 'zod';
import { AnyScopeSchema, type ApiKeyScope } from './api_key.enums';

// A key may also hold a service scope (`ServiceScopeEnum`, checked by the module that owns it), so it must parse. The static type stays
// `ApiKeyScope[]`: that is the type the admin UI maps labels over, and a service scope is not one of its verbs.
// api_key.06 (fixed 2026-10-20): every scope the create DTO accepts parses here too (the resource-level `orders:read` form included);
// it used to be saved, then fail this schema, so the one-time secret was lost and the key could never verify.
const KeyScopes = z.array(AnyScopeSchema) as unknown as z.ZodType<ApiKeyScope[]>;

export const ApiKeySchema = z.object({
  apiKeyId: z.string().uuid(),
  tenantId: z.string().uuid(),
  createdByUserId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  keyHash: z.string(),
  scopes: KeyScopes,
  // Defaulted so rows/caches written before these columns existed still parse.
  keyEnv: z.string().default('live'),
  ipAllowlist: z.array(z.string()).default([]),
  isActive: z.boolean(),
  lastUsedAt: z.date().nullable(),
  lastUsedIp: z.string().nullable().default(null),
  // `integer` round-trips through TypeORM as number; coerce defensively in case
  // a driver hands back a string, and default for legacy rows.
  usageCount: z.coerce.number().int().nonnegative().default(0),
  successorKeyId: z.string().uuid().nullable().default(null),
  expiresAt: z.date().nullable(),
  // api_key.03: an OWNER-marked service key survives its creator leaving; defaulted for rows and caches from before the column.
  isServiceKey: z.boolean().default(false),
  serviceKeyMarkedByUserId: z.string().uuid().nullable().default(null),
  // Phase 48: the module permissions the key may use (a NULL from a row before migration 002 reads as none) and the review mark.
  permissions: z.array(z.string()).nullable().default(null).transform((v) => v ?? []),
  scopeReview: z.boolean().default(false),
  createdAt: z.date(),
  updatedAt: z.date(),
});

// Never expose keyHash to clients
export const SafeApiKeySchema = ApiKeySchema.omit({ keyHash: true });

export type ApiKey = z.infer<typeof ApiKeySchema>;
export type SafeApiKey = z.infer<typeof SafeApiKeySchema>;
