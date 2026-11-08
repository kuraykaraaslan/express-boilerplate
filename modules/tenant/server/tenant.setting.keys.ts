import { z } from 'zod';

// ============================================================================
// Tenant module setting keys (the maintenance knobs, Maintenance → Settings)
// ============================================================================
//
// Every read falls back to the constants in maintenance.enums.ts, so an
// unset/broken value can never disable the gate or lock anyone out
// (sanitizers in tenant.settings-policy.ts):
//   maintenanceDefaultAllowRoles — JSON array, default '["OWNER","ADMIN"]';
//     applied when a window is created WITHOUT an explicit allowRoles, and the
//     console's create form starts with it. TENANT/ROUTE windows read the
//     target tenant's value, SYSTEM the root's.
//   maintenanceCacheTtlSeconds   — gate cache TTL (clamped 5..60, default 10). Read from ROOT only.
//   maintenancePreNotifyHours    — advance-notice lead (clamped 1..168, default 24). Read from ROOT only.
//
// The tenant's general settings (branding, contact, locale) are not this
// module's: they are declared in tenant.general.setting.keys.ts.

export const TenantSettingKeySchema = z.enum([
  'maintenanceDefaultAllowRoles', 'maintenanceCacheTtlSeconds', 'maintenancePreNotifyHours',
]);
export type TenantSettingKey = z.infer<typeof TenantSettingKeySchema>;
/** Named by module.json `settings.keys` / `settingKeys`. */
export const TENANT_KEYS = TenantSettingKeySchema.options;

export {
  TenantGeneralSettingKeySchema, TENANT_GENERAL_KEYS, type TenantGeneralSettingKey,
} from './tenant.general.setting.keys';
