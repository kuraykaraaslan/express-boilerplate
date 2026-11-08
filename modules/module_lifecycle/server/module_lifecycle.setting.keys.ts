import { z } from 'zod'

// ============================================================================
// Module Lifecycle Setting Keys
// ============================================================================

export const ModuleLifecycleSettingKeySchema = z.enum([
  // Platform setting, read ONLY from the ROOT tenant: comma-separated module ids every NEW tenant is
  // installed with (origin 'default'), through the plan check, ledger and hooks
  // (docs/phases/25-marketplace/03-module-governance/01). Written through its own ROOT route, which
  // validates every id; a tenant's own copy of the key is never read.
  'platformDefaultModules',
  // Per tenant: 'true' while a plan provisioning run left a module uninstalled (06). The hourly
  // subscription job retries only these tenants; a successful run deletes the key.
  'moduleLifecycleProvisioningPending',
  // Platform setting, read ONLY from the ROOT tenant (module_lifecycle.settings-policy.ts): days an uninstalled
  // module's data stays restorable, 1..3650. Unset keeps MODULE_RESTORE_WINDOW_DAYS (default 30).
  'moduleRestoreWindowDays',
])
export type ModuleLifecycleSettingKey = z.infer<typeof ModuleLifecycleSettingKeySchema>
export const MODULE_LIFECYCLE_KEYS = ModuleLifecycleSettingKeySchema.options
