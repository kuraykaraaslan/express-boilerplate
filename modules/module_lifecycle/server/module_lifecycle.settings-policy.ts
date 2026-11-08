import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { ModuleLifecycleSettingKey } from './module_lifecycle.setting.keys';

/**
 * The installation's module lifecycle settings (2026-10-27), read from the ROOT tenant only: an uninstall happens in a
 * tenant, but how long the platform keeps an uninstalled module's data is the operator's call, one value for every
 * tenant (a copy of the key in any other tenant is never read).
 *
 * - `moduleRestoreWindowDays`: days an uninstalled module stays restorable with its data before the daily purge job
 *   removes it (docs/phases/37-extensions/08). Was only the boot configuration's MODULE_RESTORE_WINDOW_DAYS (default
 *   30), which stays the value when the key is unset. 1..3650: a saved value can shorten or lengthen the window but
 *   never switch the undo off; an immediate purge on uninstall (a window of 0) is still only the boot configuration's.
 *   It applies to uninstalls from now on: a module already uninstalled keeps the `restorableUntil` stamped then.
 *
 * Unset, out of range, not a whole number, or a failed read: the boot configuration's value (the old behaviour).
 */

export const RESTORE_WINDOW_MIN_DAYS = 1;
export const RESTORE_WINDOW_MAX_DAYS = 3650;

const KEYS: ModuleLifecycleSettingKey[] = ['moduleRestoreWindowDays'];

/** A whole number of days in 1..3650, else `fallback` (the boot configuration's window). */
export function sanitizeRestoreWindowDays(raw: string | null | undefined, fallback: number): number {
  const v = (raw ?? '').trim();
  if (!/^\d{1,4}$/.test(v)) return fallback;
  const n = Number(v);
  return n >= RESTORE_WINDOW_MIN_DAYS && n <= RESTORE_WINDOW_MAX_DAYS ? n : fallback;
}

export interface ModuleLifecyclePolicy {
  restoreWindowDays: number;
}

/** The ROOT tenant's values; `envRestoreWindowDays` is the boot configuration's window, used when the key is unset. */
export async function getModuleLifecyclePolicy(envRestoreWindowDays: number): Promise<ModuleLifecyclePolicy> {
  let s: Record<string, string | null> = {};
  try {
    s = (await SettingService.getByKeys(ROOT_TENANT_ID, KEYS)) ?? {};
  } catch { /* defaults */ }
  return { restoreWindowDays: sanitizeRestoreWindowDays(s.moduleRestoreWindowDays, envRestoreWindowDays) };
}
