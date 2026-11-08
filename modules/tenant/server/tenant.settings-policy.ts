import { MAINTENANCE_PRE_NOTICE_LEAD_HOURS, DEFAULT_MAINTENANCE_ALLOW_ROLES } from './maintenance.enums';

/**
 * The tenant module's settings (Maintenance → Settings, keys in tenant.setting.keys.ts). Each value is checked here; a
 * missing or bad one is exactly the earlier constant, so no stored value can switch the maintenance gate off, spam the
 * advance notices, or lock an operator out. The reads (dynamic import, try/catch, ROOT for the platform keys) stay in
 * maintenance.service.ts, which applies these.
 *
 * - `maintenanceDefaultAllowRoles` (per tenant; SYSTEM windows read ROOT's): the member roles that pass a window created
 *   without an explicit `allowRoles`, and what the console's create form starts with. A JSON array of non-empty strings;
 *   anything else, or an empty array (a self-lockout), is the constant `["OWNER","ADMIN"]`. Platform ADMINs always pass.
 * - `maintenanceCacheTtlSeconds` (ROOT only): how long the gate caches the candidate windows. Clamped 5..60; was 10.
 * - `maintenancePreNotifyHours` (ROOT only): how far ahead a scheduled window gets its one advance notice. Clamped
 *   1..168; was 24.
 */

/** The gate's candidate-window cache TTL when unset (seconds). */
export const MAINTENANCE_CACHE_TTL_SECONDS = 10;

function int(raw: string | null | undefined): number {
  return raw ? Number.parseInt(raw, 10) : Number.NaN;
}

export function sanitizeMaintenanceCacheTtl(raw: string | null | undefined): number {
  const parsed = int(raw);
  return Number.isFinite(parsed) ? Math.min(60, Math.max(5, parsed)) : MAINTENANCE_CACHE_TTL_SECONDS;
}

export function sanitizeMaintenancePreNotifyHours(raw: string | null | undefined): number {
  const parsed = int(raw);
  return Number.isFinite(parsed) ? Math.min(168, Math.max(1, parsed)) : MAINTENANCE_PRE_NOTICE_LEAD_HOURS;
}

/** Never empty: a bad or empty value is the constant. */
export function sanitizeMaintenanceAllowRoles(raw: string | null | undefined): string[] {
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed) && parsed.length > 0 && parsed.every((r) => typeof r === 'string' && r.length > 0)) {
        return parsed;
      }
    } catch { /* malformed setting → constant */ }
  }
  return [...DEFAULT_MAINTENANCE_ALLOW_ROLES];
}
