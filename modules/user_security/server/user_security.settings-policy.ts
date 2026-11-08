import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { TenantSecuritySettingKey } from './user_security.setting.keys';

/**
 * The installation's user_security settings (2026-10-27), read from the ROOT tenant only: a person is one account across
 * every tenant and a trusted device is stored on that account (`user_security.trustedDevices`), minted at the central
 * sign-in, so its lifetime is the operator's, one value for the installation. A copy of the key in any other tenant is
 * never read. Edited on the ROOT page /admin/settings/trusted-devices.
 *
 * - `trustedDeviceTtlDays`: how long "trust this device" skips the sign-in code. Was the constant 30 days
 *   (`TRUSTED_DEVICE_DAYS`, user_session.cookie.next.ts, passed by auth's otp-verify route). 1..30: it can only SHORTEN the
 *   lifetime, never lengthen it. It applies to a device trusted from now on (its `expiresAt`) and to one trusted before
 *   (`isDeviceTrusted` also ends a device `createdAt + ttl` after it was trusted), so shortening it takes effect at once.
 *
 * Unset, not a whole number in range, or a failed read keeps the old 30 days.
 */

export const TRUSTED_DEVICE_TTL_DEFAULT_DAYS = 30;
export const TRUSTED_DEVICE_TTL_MIN_DAYS = 1;
/** The ceiling: the old constant. A setting can only shorten it. */
export const TRUSTED_DEVICE_TTL_MAX_DAYS = 30;

const KEYS: TenantSecuritySettingKey[] = ['trustedDeviceTtlDays'];

/** A whole number of days in 1..30; anything else -> 30. */
export function sanitizeTrustedDeviceTtlDays(raw: string | null | undefined): number {
  const v = (raw ?? '').trim();
  if (!/^\d{1,3}$/.test(v)) return TRUSTED_DEVICE_TTL_DEFAULT_DAYS;
  const n = Number(v);
  return n >= TRUSTED_DEVICE_TTL_MIN_DAYS && n <= TRUSTED_DEVICE_TTL_MAX_DAYS ? n : TRUSTED_DEVICE_TTL_DEFAULT_DAYS;
}

export interface UserSecurityPolicy {
  trustedDeviceTtlDays: number;
}

export const DEFAULT_USER_SECURITY_POLICY: UserSecurityPolicy = { trustedDeviceTtlDays: TRUSTED_DEVICE_TTL_DEFAULT_DAYS };

export async function getUserSecurityPolicy(): Promise<UserSecurityPolicy> {
  let s: Record<string, string | null> = {};
  try {
    s = (await SettingService.getByKeys(ROOT_TENANT_ID, KEYS)) ?? {};
  } catch { /* defaults */ }
  return { trustedDeviceTtlDays: sanitizeTrustedDeviceTtlDays(s.trustedDeviceTtlDays) };
}
