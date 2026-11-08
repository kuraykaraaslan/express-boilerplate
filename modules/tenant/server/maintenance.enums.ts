import { z } from 'zod';

/**
 * Maintenance is a SEPARATE dimension from tenant lifecycle — deliberately NOT
 * a `TenantStatus` value (locked decision, docs/phases/16-tenant README): `SUSPENDED`
 * is administrative/punitive, maintenance is temporary and planned. A tenant
 * stays `ACTIVE` while under maintenance, so ending a window needs no status
 * restore and can never lose the "was it already suspended?" answer.
 */

/** What a window applies to: the whole platform, one tenant, or route patterns within a tenant. */
export const MaintenanceScopeEnum = z.enum(['SYSTEM', 'TENANT', 'ROUTE']);
export type MaintenanceScope = z.infer<typeof MaintenanceScopeEnum>;

export const MaintenanceStatusEnum = z.enum(['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']);
export type MaintenanceStatus = z.infer<typeof MaintenanceStatusEnum>;

/**
 * FULL takes everything down; READ_ONLY is the soft option for migrations and
 * backups — reads keep working, writes 503. Method-based, so a side-effectful
 * GET is not covered (known limit, phase-2 risk note).
 */
export const MaintenanceModeEnum = z.enum(['FULL', 'READ_ONLY']);
export type MaintenanceMode = z.infer<typeof MaintenanceModeEnum>;

/** Methods that pass a READ_ONLY window. */
export const READ_ONLY_SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'] as const;

/** Default escape hatch — never empty, or the operator locks themselves out. */
export const DEFAULT_MAINTENANCE_ALLOW_ROLES = ['OWNER', 'ADMIN'] as const;

/** SCHEDULED windows starting within this lead get their one advance notice. */
export const MAINTENANCE_PRE_NOTICE_LEAD_HOURS = 24;
