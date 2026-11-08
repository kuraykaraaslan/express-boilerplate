import { z } from 'zod';

// ============================================================================
// Tenant General Setting Keys
// ============================================================================
//
// The tenant's general settings (branding colours, contact details, locale), written by tenant_setting's General page and
// read across modules. They are not the tenant module's own settings: those (the maintenance knobs) are declared in
// tenant.setting.keys.ts and owned by the tenant module's permission. Moved here 2026-10-27 so that file lists only its own keys.

export const TenantGeneralSettingKeySchema = z.enum([
  // `tenantName`/`tenantDescription` retired 2026-09-15: nothing ever read them
  // (the real name/description live on the `tenants.name`/`description`
  // columns — see `tenant-profile.route.ts`). Keeping the dead keys writable
  // let the General tab silently no-op a rename; removing them from the
  // schema makes `tenant_setting`'s key-allowlist reject them instead.
  'logoUrl', 'faviconUrl',
  'primaryColor', 'secondaryColor', 'accentColor',
  'contactEmail', 'contactPhone', 'contactAddress',
  'timezone', 'language', 'dateFormat', 'timeFormat',
]);
export type TenantGeneralSettingKey = z.infer<typeof TenantGeneralSettingKeySchema>;
export const TENANT_GENERAL_KEYS = TenantGeneralSettingKeySchema.options;
