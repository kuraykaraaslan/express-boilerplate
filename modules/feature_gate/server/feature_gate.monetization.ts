import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * The global monetization kill-switch: whether entitlement enforcement is on at all.
 *
 * Lives in `feature_gate` (the gate every entitlement check passes through), so a module that enforces limits can ask it without
 * depending on the module that sells plans (`tenant_subscription` writes the setting and reads the rest of the monetization
 * configuration).
 *
 * It is a ROOT-tenant setting read with ROOT-wins semantics: a normal tenant cannot override `monetizationEnabled`, so this is a true
 * operator kill-switch. Default is ENABLED (true): the platform enforces entitlements out of the box. The operator can still pin it OFF
 * by explicitly setting `monetizationEnabled` to 'false' (free mode: installs bypass the entitlement gates). Read FAILURES fail
 * CLOSED (enforcement stays on, tenant_subscription.17, fixed 2026-10-20): a settings or database outage must not switch every
 * entitlement gate off for the whole platform.
 *
 * SettingService is reached via dynamic import because `tenant_setting` is not a hard `requires` of this module; its reads are
 * Redis-cached, so this stays cheap on the hot path.
 */

/** Platform default for the kill-switch when the setting is unset. */
export const DEFAULT_MONETIZATION_ENABLED = true;

async function getSettingService() {
  return (await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service')).default;
}

export function parseBoolWithDefault(raw: string | null | undefined, def: boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return def;
  return raw === 'true' || raw === '1';
}

/**
 * Whether monetization/entitlement enforcement is globally enabled. Reads ONLY the ROOT tenant's `monetizationEnabled` setting.
 * A read failure keeps enforcement ON (fail closed, tenant_subscription.17).
 */
export async function isMonetizationEnabled(): Promise<boolean> {
  try {
    const SettingService = await getSettingService();
    const raw = await SettingService.getValue(ROOT_TENANT_ID, 'monetizationEnabled');
    return parseBoolWithDefault(raw, DEFAULT_MONETIZATION_ENABLED);
  } catch (err) {
    Logger.warn(
      `Monetization: kill-switch read failed, failing closed (enforcing): ${err instanceof Error ? err.message : String(err)}`,
    );
    return true;
  }
}
