import { z } from 'zod';
import { AuditActorTypeEnum, AuditSeverityEnum } from './audit_log.enums';
import { AUDIT_LOG_PAGE_SIZE_HARD_CAP } from './audit_log.setting.keys';
import { sortParam } from '@kuraykaraaslan-labs/common/server/common.list-query';

export const CreateAuditLogDTO = z.object({
  // tenantId is optional/nullable on the input — service defaults to
  // ROOT_TENANT_ID for platform-level events. Every persisted row, however,
  // has a real tenantId (the column is NOT NULL).
  tenantId:           z.string().uuid().nullable().optional(),
  actorId:            z.string().uuid().nullable().optional(),
  actorType:          AuditActorTypeEnum.default('SYSTEM'),
  // Dual-actor (impersonation): the impersonated user, when the true actor
  // (actorId) is acting on their behalf. Optional + additive.
  onBehalfOfActorId:  z.string().uuid().nullable().optional(),
  // Cross-tenant actor. Normally left out: `log()` fills it from the request context
  // (a Fleet break-glass session).
  actorTenantId:      z.string().uuid().nullable().optional(),
  // SERVICE actors (fleet executions): the signed command and the node it ran on. Stored and hashed only by the
  // sealed (hashVersion 2) chain; the legacy chain cannot cover them and ignores them.
  commandJti:         z.string().uuid().nullable().optional(),
  nodeId:             z.string().uuid().nullable().optional(),
  action:             z.string().min(1),
  // Optional override; when omitted the service derives severity from the
  // action via severityForAction().
  severity:           AuditSeverityEnum.optional(),
  resourceType:       z.string().nullable().optional(),
  resourceId:         z.string().nullable().optional(),
  metadata:           z.record(z.string(), z.any()).optional(),
  ipAddress:          z.string().nullable().optional(),
  userAgent:          z.string().nullable().optional(),
});

// Reusable coercion: ISO date string (or Date) → Date. Accepts a string OR a
// Date on input (so route handlers can forward raw query params) and always
// outputs a Date.
const DateLike = z.union([z.string(), z.date()]).pipe(z.coerce.date());

/** The columns a tenant's audit list can sort by (public field → entity property). */
export const AUDIT_LOG_SORTABLE = { createdAt: 'createdAt', action: 'action', resourceType: 'resourceType' } as const;

export const GetAuditLogsDTO = z.object({
  tenantId:     z.string().uuid().nullable().optional(),
  actorId:      z.string().uuid().nullable().optional(),
  action:       z.string().nullable().optional(),
  severity:     AuditSeverityEnum.nullable().optional(),
  resourceType: z.string().nullable().optional(),
  resourceId:   z.string().nullable().optional(),
  // Exact action names left out (the home feed's machine events such as `abac.decision`, e2e run 1 E21); the list's own search stays `action`.
  excludeActions: z.array(z.string().min(1).max(128)).max(20).optional(),
  // Cross-tenant rows only: a tenant id narrows to that tenant, `'any'`
  // to rows written by an actor from any other tenant (actorTenantId IS NOT NULL).
  actorTenantId: z.union([z.string().uuid(), z.literal('any')]).nullable().optional(),
  // Inclusive date-range filter on createdAt.
  fromDate:     DateLike.nullable().optional(),
  toDate:       DateLike.nullable().optional(),
  page:         z.number().int().min(1).default(1),
  // Upper bound is the hard cap; the effective per-tenant cap (defaulting to
  // 100, see AUDIT_LOG_DEFAULT_MAX_PAGE_SIZE) is enforced in audit_log.query.ts
  // via the tenant's `auditLogMaxPageSize` setting.
  pageSize:     z.number().int().min(1).max(AUDIT_LOG_PAGE_SIZE_HARD_CAP).default(20),
  // `field:dir` from AUDIT_LOG_SORTABLE only; anything else is refused. Newest first when absent.
  sort:         sortParam(Object.keys(AUDIT_LOG_SORTABLE) as (keyof typeof AUDIT_LOG_SORTABLE)[]).optional(),
});

export const PurgeAuditLogsDTO = z.object({
  tenantId: z.string().uuid(),
  // When true, rows are serialized to NDJSON (returned to the caller / exporter)
  // before being hard-deleted.
  archive:  z.boolean().default(false),
});

export const ExportAuditLogsDTO = z.object({
  tenantId: z.string().uuid(),
  actorId:  z.string().uuid().nullable().optional(),
  fromDate: DateLike.nullable().optional(),
  toDate:   DateLike.nullable().optional(),
  format:   z.enum(['csv', 'ndjson']).default('ndjson'),
});

export const AnonymizeActorDTO = z.object({
  tenantId: z.string().uuid(),
  actorId:  z.string().uuid(),
});

/**
 * Deepest row the cross-tenant view will page to (page * pageSize). Every page
 * makes each tenant return up to page * pageSize rows, so without a ceiling a
 * deep page loaded tenants x depth rows. Past this, narrow the window or the
 * tenant filter (or use the per-tenant export) instead of paging further.
 */
export const CROSS_TENANT_MAX_DEPTH = 1000;

// Cross-tenant aggregated query (root tenant only).
export const CrossTenantAuditQueryDTO = z.object({
  // Optional single-tenant filter — when set, the root-tenant viewer scopes the
  // aggregated view down to just this tenant's logs.
  tenantId: z.string().uuid().nullable().optional(),
  action:   z.string().nullable().optional(),
  // Exact action names left out (the home feed's machine events, e2e run 1 E21).
  excludeActions: z.array(z.string().min(1).max(128)).max(20).optional(),
  severity: AuditSeverityEnum.nullable().optional(),
  fromDate: DateLike.nullable().optional(),
  toDate:   DateLike.nullable().optional(),
  page:     z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  // Retained for backward-compat callers that page via a hard cap instead of
  // page/pageSize; ignored when page-based params are used.
  limit:    z.number().int().min(1).max(1000).default(200),
  // The merge across tenants orders by time only: `createdAt:asc` or `createdAt:desc` (the default).
  sort:     sortParam(['createdAt'] as const).optional(),
}).refine((q) => q.page * q.pageSize <= CROSS_TENANT_MAX_DEPTH, {
  message: `page * pageSize must not exceed ${CROSS_TENANT_MAX_DEPTH}`,
  path: ['page'],
});

// Input types use z.input so callers may pass the pre-parse shape (e.g. raw
// ISO date strings for the DateLike fields, optional fields omitted).
export type CreateAuditLogInput      = z.input<typeof CreateAuditLogDTO>;
export type GetAuditLogsInput        = z.input<typeof GetAuditLogsDTO>;
export type PurgeAuditLogsInput      = z.input<typeof PurgeAuditLogsDTO>;
export type ExportAuditLogsInput     = z.input<typeof ExportAuditLogsDTO>;
export type AnonymizeActorInput      = z.input<typeof AnonymizeActorDTO>;
export type CrossTenantAuditQueryInput = z.input<typeof CrossTenantAuditQueryDTO>;
