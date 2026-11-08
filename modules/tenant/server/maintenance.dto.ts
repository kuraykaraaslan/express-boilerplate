import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query';
import { z } from 'zod';
import { TenantMemberRoleEnum } from '@kuraykaraaslan-labs/tenant_member/server/tenant_member.enums';
import { MaintenanceScopeEnum, MaintenanceStatusEnum, MaintenanceModeEnum } from './maintenance.enums';

// ============================================================================
// Shapes
// ============================================================================

export const MaintenanceWindowSchema = z.object({
  windowId: z.string().uuid(),
  tenantId: z.string().uuid().nullable(),
  title: z.string(),
  message: z.string().nullable(),
  scope: MaintenanceScopeEnum,
  routePatterns: z.array(z.string()).nullable(),
  status: MaintenanceStatusEnum,
  // Defaults on the phase-2 fields keep rows/cache entries written before the
  // columns existed parseable (synchronize backfills the DB, not the cache).
  mode: MaintenanceModeEnum.default('FULL'),
  percentage: z.number().int().min(1).max(100).nullable().default(null),
  preNotifiedAt: z.date().nullable().default(null),
  scheduledStart: z.date(),
  scheduledEnd: z.date().nullable(),
  actualStart: z.date().nullable(),
  actualEnd: z.date().nullable(),
  allowRoles: z.array(z.string()).min(1),
  createdByUserId: z.string().uuid().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export type MaintenanceWindowView = z.infer<typeof MaintenanceWindowSchema>;

/** The subset the hot-path gate needs — small enough to cache per tenant. */
export const ActiveWindowSchema = MaintenanceWindowSchema.pick({
  windowId: true, tenantId: true, title: true, message: true, scope: true,
  routePatterns: true, status: true, mode: true, percentage: true,
  scheduledStart: true, scheduledEnd: true, allowRoles: true,
});
export type ActiveWindow = z.infer<typeof ActiveWindowSchema>;

// ============================================================================
// Inputs
// ============================================================================

/**
 * A route pattern: `*` is the only wildcard, and at most MAX_ROUTE_WILDCARDS of them (tenant.02, fixed 2026-10-20). A
 * pattern stacking wildcards was the input of the backtracking blow-up the matcher used to have.
 */
export const MAX_ROUTE_WILDCARDS = 3;
const RoutePattern = z.string().min(1).max(300)
  .refine((p) => (p.match(/\*/g)?.length ?? 0) <= MAX_ROUTE_WILDCARDS, `A route pattern may hold at most ${MAX_ROUTE_WILDCARDS} wildcards`);

/**
 * A role that bypasses the gate (41-ui-fixes/09 B1.2): a member role, never free text. The gate compares it with the
 * caller's `memberRole`, so a typo ("admin", "OWNERS") used to save fine and lock the operator out on the next request.
 * Case is normalised here; the gate also compares case-insensitively for rows written before.
 */
const AllowRole = z.string().trim().toUpperCase().pipe(TenantMemberRoleEnum);
// min(1): an empty allowlist locks the operator out with no in-app way back (locked decision — the escape hatch is not
// optional). Duplicates collapse, so ["admin", "ADMIN"] is one role.
const AllowRoles = z.array(AllowRole).min(1).transform((roles) => [...new Set(roles)]);

export const CreateMaintenanceWindowDTO = z.object({
  /** null/omitted with scope SYSTEM = the whole platform. */
  tenantId: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  message: z.string().max(2000).optional(),
  scope: MaintenanceScopeEnum.default('TENANT'),
  routePatterns: z.array(RoutePattern).max(50).optional(),
  mode: MaintenanceModeEnum.default('FULL'),
  /** Canary share (percentage of subjects that SEE the maintenance); omit = everyone. */
  percentage: z.number().int().min(1).max(100).optional(),
  scheduledStart: z.coerce.date(),
  scheduledEnd: z.coerce.date().optional(),
  // Omitted entirely → the service fills it from the maintenanceDefaultAllowRoles
  // setting, then DEFAULT_MAINTENANCE_ALLOW_ROLES (phase 4).
  allowRoles: AllowRoles.optional(),
}).superRefine((val, ctx) => {
  if (val.scope === 'ROUTE' && (!val.routePatterns || val.routePatterns.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['routePatterns'], message: 'ROUTE scope requires at least one route pattern' });
  }
  if (val.scope === 'SYSTEM' && val.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tenantId'], message: 'SYSTEM scope cannot target a single tenant' });
  }
  if (val.scope !== 'SYSTEM' && !val.tenantId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['tenantId'], message: 'TENANT/ROUTE scope requires a tenantId' });
  }
  if (val.scheduledEnd && val.scheduledEnd <= val.scheduledStart) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledEnd'], message: 'scheduledEnd must be after scheduledStart' });
  }
});
export type CreateMaintenanceWindowDTO = z.infer<typeof CreateMaintenanceWindowDTO>;

/**
 * An edit. `null` clears a field (message, canary share, end — 41-ui-fixes/09 B1.1); a key left out keeps the stored
 * value. The checks that need the stored row (end after start on the merged times, a ROUTE window keeping a pattern,
 * the operator not locking themselves out) run in `MaintenanceService.updateWindow`.
 */
export const UpdateMaintenanceWindowDTO = z.object({
  title: z.string().min(1).max(200).optional(),
  message: z.string().max(2000).nullable().optional(),
  // 41-ui-fixes/09 B1.5: never an empty list; a ROUTE window without a pattern gates nothing.
  routePatterns: z.array(RoutePattern).min(1).max(50).nullable().optional(),
  mode: MaintenanceModeEnum.optional(),
  percentage: z.number().int().min(1).max(100).nullable().optional(),
  // Pushing scheduledEnd forward IS the "extend the maintenance" operation —
  // allowed while SCHEDULED or IN_PROGRESS (updateWindow refuses closed rows).
  scheduledStart: z.coerce.date().optional(),
  scheduledEnd: z.coerce.date().nullable().optional(),
  allowRoles: AllowRoles.optional(),
}).superRefine((val, ctx) => {
  // Both times in the body: refuse here; one of them: the service checks it against the stored other (1.7).
  if (val.scheduledStart && val.scheduledEnd && val.scheduledEnd <= val.scheduledStart) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scheduledEnd'], message: 'scheduledEnd must be after scheduledStart' });
  }
});
export type UpdateMaintenanceWindowDTO = z.infer<typeof UpdateMaintenanceWindowDTO>;

/** Public sort fields of the maintenance windows → entity properties (phase 43 list contract). */
export const MAINTENANCE_SORTABLE = {
  title: 'title',
  scope: 'scope',
  mode: 'mode',
  status: 'status',
  scheduledStart: 'scheduledStart',
  scheduledEnd: 'scheduledEnd',
  createdAt: 'createdAt',
} as const;

/**
 * The maintenance windows (phase 43 list contract): latest start first unless sorted; several statuses, scopes and modes
 * (a single status still works), a start-day range, a search over title and message. 0-based, 20 rows by default, at
 * most 100. `tenantId` and `includeSystem` are set by the route from the path, never read from the query.
 */
export const GetMaintenanceWindowsQuery = listQuerySchema({
  sortable: MAINTENANCE_SORTABLE,
  defaultSort: 'scheduledStart:desc',
  filters: {
    status: listFilter.oneOf(MaintenanceStatusEnum.options),
    scope: listFilter.oneOf(MaintenanceScopeEnum.options),
    mode: listFilter.oneOf(MaintenanceModeEnum.options),
    startFrom: listFilter.day(),
    startTo: listFilter.day(),
  },
}).extend({
  tenantId: z.string().uuid().optional(),
  /** With `tenantId`: also return SYSTEM (tenantId=null) windows — they gate this tenant too. */
  includeSystem: z.preprocess((v) => v === 'true' || v === true, z.boolean()).default(false),
});
export type GetMaintenanceWindowsQuery = z.infer<typeof GetMaintenanceWindowsQuery>;
