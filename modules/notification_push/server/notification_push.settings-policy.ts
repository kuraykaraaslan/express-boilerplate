import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';

/**
 * The push settings shown on Settings → Push (`/admin/settings/push`, 2026-10-27). Both keys were read before with no
 * page; unset keeps the earlier behaviour, a bad value or a failed read is the default.
 *
 * - `pushMaxSubscriptionsPerUser`: how many devices (browsers and app installs) one member may register; a new one past
 *   the cap is refused 429. Was any number > 0, default 10; now a whole number 1..100, anything else is 10.
 * - `pushProvider`: the key of the push plugin browsers are sent through when several are installed. Was any value,
 *   default `webpush`; now a plugin key (letters, digits, `@ / . _ -`, at most 100), anything else is `webpush`. A key that
 *   is not installed still falls to the first configured plugin, then the first installed (resolvePushProvider).
 *
 * Read one key at a time (getValue), each at the moment it is needed, as before.
 */

export const DEFAULT_MAX_SUBSCRIPTIONS_PER_USER = 10;
export const MAX_SUBSCRIPTIONS_PER_USER_CEILING = 100;
export const DEFAULT_PUSH_PROVIDER = 'webpush';

export function sanitizeMaxSubscriptions(value: string | null | undefined): number {
  const n = Number(value);
  return value != null && Number.isInteger(n) && n >= 1 && n <= MAX_SUBSCRIPTIONS_PER_USER_CEILING
    ? n : DEFAULT_MAX_SUBSCRIPTIONS_PER_USER;
}

export function sanitizePushProvider(value: string | null | undefined): string {
  const v = (value ?? '').trim();
  return /^[A-Za-z0-9@/._-]{1,100}$/.test(v) ? v : DEFAULT_PUSH_PROVIDER;
}

export async function getMaxSubscriptionsPerUser(tenantId: string): Promise<number> {
  let raw: string | null = null;
  try { raw = await SettingService.getValue(tenantId, 'pushMaxSubscriptionsPerUser'); } catch { /* default */ }
  return sanitizeMaxSubscriptions(raw);
}

export async function getPushProviderKey(tenantId: string): Promise<string> {
  let raw: string | null = null;
  try { raw = await SettingService.getValue(tenantId, 'pushProvider'); } catch { /* default */ }
  return sanitizePushProvider(raw);
}
