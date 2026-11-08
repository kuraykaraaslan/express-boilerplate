import { z } from 'zod';
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch';
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { ApiKeyEnvEnum, AnyScopeSchema } from './api_key.enums';
// Subnet (CIDR) validation is owned by the network module. A single host is a
// /32 — e.g. 192.168.1.182/32.
import { SubnetListSchema } from '@kuraykaraaslan-labs/ip_subnet';

// A permission id as the manifests write it (`iot_device.devices.read`); whether it exists and may be given to a key is the
// service's question (api_key.permissions.ts), the shape is the DTO's.
const PermissionIdSchema = z.string().min(3).max(120).regex(/^[a-z0-9_]+(\.[a-z0-9_]+)+$/);
// Bounded like the scopes; above the largest module's permission count times a few modules, far below an abuse size.
const PermissionListSchema = z.array(PermissionIdSchema).max(500);

export const CreateApiKeyDTO = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  // api_key.07 (fixed 2026-10-20): bounded (it was an unbounded array). Phase 48: optional, a key may hold module permissions only.
  scopes: z.array(AnyScopeSchema).max(100).default([]),
  // Phase 48 (D11): the module permissions the key may use on module routes, within its creator's (D12).
  permissions: PermissionListSchema.default([]),
  environment: ApiKeyEnvEnum.optional(),
  ipAllowlist: SubnetListSchema.max(100).optional(),
  // Phase 48 (D13): absent is now + 90 days; at most 365 days out (api_key.policy resolveExpiry).
  expiresAt: z.string().datetime().optional(),
}).refine((v) => v.scopes.length + v.permissions.length > 0, {
  message: 'Select at least one module permission or integration scope.',
  path: ['permissions'],
});

export const UpdateApiKeyDTO = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  ipAllowlist: SubnetListSchema.max(100).optional(),
  isActive: z.boolean().optional(),
  /** api_key.03: only an OWNER may set or clear it (403 otherwise). */
  isServiceKey: z.boolean().optional(),
  /** Phase 48: the key's new module permission list. Removing is free; an added one must be held by the editor (D12). */
  permissions: PermissionListSchema.optional(),
  /** Phase 48: the key's integration scopes, only ever narrowed (a subset of the current ones). */
  scopes: z.array(AnyScopeSchema).max(100).optional(),
  /** Phase 48 (D14): an admin looked at the key and keeps its grant; clears the review mark. */
  scopeReviewed: z.literal(true).optional(),
});

export const RotateApiKeyDTO = z.object({
  // Grace window during which the old key keeps working alongside the successor.
  // 0 = revoke the old key immediately.
  graceSeconds: z.number().int().min(0).max(60 * 60 * 24 * 30).default(60 * 60 * 24),
});

/** The key columns the list can sort by (public field → entity property). */
export const API_KEY_SORTABLE = {
  name: 'name',
  lastUsedAt: 'lastUsedAt',
  expiresAt: 'expiresAt',
  usageCount: 'usageCount',
  isActive: 'isActive',
  createdAt: 'createdAt',
} as const;

export const ListApiKeysDTO = listQuerySchema({
  sortable: API_KEY_SORTABLE,
  defaultSort: 'createdAt:desc',
  pageBase: 1,
  filters: {
    isActive: listFilter.flag(),
    environment: listFilter.oneOf(ApiKeyEnvEnum.options),
    // Phase 48 (D14): the keys marked for review (the banner's "Show them").
    scopeReview: listFilter.flag(),
  },
}).extend({
  // The path tenant, validated with the query so a malformed one is a 400 before anything is read.
  tenantId: z.string().uuid(),
});

// The input side: `scopes` and `permissions` may be left out by a caller in code (they default to none).
export type CreateApiKeyInput = z.input<typeof CreateApiKeyDTO>;
export type UpdateApiKeyInput = z.infer<typeof UpdateApiKeyDTO>;
export type ListApiKeysInput = z.infer<typeof ListApiKeysDTO>;
export type RotateApiKeyInput = z.infer<typeof RotateApiKeyDTO>;

// ── Scope-definition master data ───────────────────────────────────────────
export const CreateScopeDefinitionDTO = z.object({
  scope: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  category: z.string().max(60).optional().default('General'),
  isActive: z.boolean().optional().default(true),
});
export const UpdateScopeDefinitionDTO = patchSchema(CreateScopeDefinitionDTO);
/** The scope-definition columns the list can sort by (public field → entity property). */
export const SCOPE_DEFINITION_SORTABLE = {
  scope: 'scope',
  label: 'label',
  category: 'category',
  isActive: 'isActive',
  createdAt: 'createdAt',
} as const;

export const ListScopeDefinitionsDTO = listQuerySchema({
  sortable: SCOPE_DEFINITION_SORTABLE,
  // grouped by category, as the panel always showed them
  defaultSort: 'category:asc,scope:asc',
  pageSize: { default: 50, max: 100 },
  filters: { isActive: listFilter.flag(), category: listFilter.value() },
});

export type CreateScopeDefinitionInput = z.infer<typeof CreateScopeDefinitionDTO>;
export type UpdateScopeDefinitionInput = z.infer<typeof UpdateScopeDefinitionDTO>;
export type ListScopeDefinitionsInput = z.infer<typeof ListScopeDefinitionsDTO>;

// ── Report date-range query ────────────────────────────────────────────────
export const ReportRangeDTO = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});
export type ReportRangeInput = z.infer<typeof ReportRangeDTO>;
