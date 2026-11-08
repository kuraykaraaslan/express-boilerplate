import redis from '@kuraykaraaslan-labs/redis';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import UserPreferencesService from '@kuraykaraaslan-labs/user_preferences/server/user_preferences.service';
import type { UserPreferences } from '@kuraykaraaslan-labs/user_preferences/server/user_preferences.types';

/**
 * Maps a notification category (`type`) to the canonical per-category opt-in
 * field on the user_preferences module. Only marketing/consent categories are
 * user-toggleable; operational categories (billing, support, wallet…) are not
 * modelled there and fall through to the module-local opt-out set.
 */
export const CATEGORY_PREFERENCE_FIELD: Record<string, keyof UserPreferences> = {
  newsletter: 'newsletter',
  product: 'productUpdates',
  product_update: 'productUpdates',
  product_updates: 'productUpdates',
  promo: 'promotionalOffers',
  promotion: 'promotionalOffers',
  promotions: 'promotionalOffers',
  promotional: 'promotionalOffers',
  marketing: 'promotionalOffers',
  offers: 'promotionalOffers',
};

/**
 * Canonical notification opt-ins from the user_preferences module. A user without a row has the DEFAULTS (06-user 1.3: every
 * marketing consent off), not "no opt-out". Best-effort: resolves to `null` only when preferences can't be read, so channel
 * toggles fail open (deliver) while consent categories fail closed (`isCategoryOptedOut`).
 */
export async function getNotificationPrefs(userId: string, tenantId?: string): Promise<UserPreferences | null> {
  try {
    return (await UserPreferencesService.getByUserId(userId)) ?? (await UserPreferencesService.getDefaults(tenantId));
  } catch {
    return null;
  }
}

/** The longest feed retention a tenant may set (days). */
export const MAX_RETENTION_DAYS = 365;

/**
 * `inAppRetentionDays` (Settings → In-app Notifications, 2026-10-27) as whole days, or null when unset or invalid. Was any
 * `parseInt` > 0; now a whole number 1..365 (`2.5`, `1e3`, `400` are the default, as `0`, `-4` and text were before).
 */
export function sanitizeRetentionDays(raw: string | null | undefined): number | null {
  const v = (raw ?? '').trim();
  if (!/^\d{1,4}$/.test(v)) return null;
  const days = Number(v);
  return days >= 1 && days <= MAX_RETENTION_DAYS ? days : null;
}

/**
 * Per-tenant retention TTL in seconds (`inAppRetentionDays`, default `fallbackTtl`): the TTL of a member's feed, refreshed
 * on each new item, and of its read marks, so a read item does not turn unread again while it is still kept.
 */
export async function resolveRetentionTtl(tenantId: string, fallbackTtl: number): Promise<number> {
  const raw = await SettingService.getValue(tenantId, 'inAppRetentionDays').catch(() => null);
  const days = sanitizeRetentionDays(raw);
  return days ? days * 24 * 60 * 60 : fallbackTtl;
}

/**
 * Quiet hours (`inAppQuietHours` = "HH:MM-HH:MM", server time): suppress the
 * push fan-out (the in-app item is still stored) during the window.
 */
export async function isInQuietHours(tenantId: string): Promise<boolean> {
  const raw = await SettingService.getValue(tenantId, 'inAppQuietHours').catch(() => null);
  const m = raw?.match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
  if (!m) return false;
  const now = new Date();
  const cur = now.getHours() * 60 + now.getMinutes();
  const start = +m[1] * 60 + +m[2];
  const end = +m[3] * 60 + +m[4];
  return start <= end ? cur >= start && cur < end : cur >= start || cur < end; // wraps midnight
}

/**
 * Whether the user has opted out of a notification category. Prefers the
 * canonical user_preferences per-category opt-ins; falls back to this module's
 * local Redis opt-out set (which also covers operational categories that
 * user_preferences does not model). A consent category is opt-in (06-user 1.3):
 * only a granted consent delivers it, so an off consent, a missing field or an
 * unreadable preference (`null`) counts as opted out. Operational categories
 * never consult preferences, so an unreadable row never blocks them.
 *
 * @param optOutKey the tenant-scoped module-local opt-out Redis set key.
 * @param prefs pre-loaded preferences to reuse (`undefined` = load on demand,
 *              `null` = known-unavailable). Lets `push()` read prefs once.
 */
export async function isCategoryOptedOut(
  optOutKey: string,
  userId: string,
  type?: string | null,
  prefs?: UserPreferences | null,
): Promise<boolean> {
  if (!type) return false;
  // Canonical source: the recipient's per-category opt-in in user_preferences.
  const key = type.toLowerCase();
  // Own keys only: `__proto__` / `constructor` must not resolve to an Object.prototype member.
  const field = Object.hasOwn(CATEGORY_PREFERENCE_FIELD, key) ? CATEGORY_PREFERENCE_FIELD[key] : undefined;
  if (field) {
    const resolved = prefs === undefined ? await getNotificationPrefs(userId) : prefs;
    if (resolved?.[field] !== true) return true;
  }
  // Fallback: module-local opt-out set.
  return (await redis.sismember(optOutKey, type).catch(() => 0)) === 1;
}
