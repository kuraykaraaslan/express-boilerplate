import type { Repository } from 'typeorm';
import type { ApiKey as ApiKeyEntity } from './entities/api_key.entity';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { parseSubnetString } from '@kuraykaraaslan-labs/ip_subnet';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { API_KEY_SETTING_KEYS } from './api_key.setting.keys';
import ApiKeyMessages from './api_key.messages';

export const DAY_MS = 24 * 60 * 60 * 1000;

// Keys unused for this long that then verify from a brand-new IP are flagged as
// a usage anomaly (possible credential leak after dormancy).
export const ANOMALY_DORMANCY_DAYS = 14;

export interface TenantPolicy {
  maxActiveKeys: number;
  maxTtlDays: number;
  requireExpiry: boolean;
  tenantIpAllowlist: string[];
  defaultRateLimitPerMinute: number;
  allowedScopes: string[];
}

// ============================================================================
// Per-tenant policy resolution (max keys, max TTL, require-expiry)
// ============================================================================

export async function getTenantPolicy(tenantId: string): Promise<TenantPolicy> {
  const keys = [
    API_KEY_SETTING_KEYS.MAX_ACTIVE_KEYS,
    API_KEY_SETTING_KEYS.MAX_TTL_DAYS,
    API_KEY_SETTING_KEYS.REQUIRE_EXPIRY,
    API_KEY_SETTING_KEYS.TENANT_IP_ALLOWLIST,
    API_KEY_SETTING_KEYS.DEFAULT_RATE_LIMIT_PER_MINUTE,
    API_KEY_SETTING_KEYS.ALLOWED_SCOPES,
  ];
  let values: Record<string, string> = {};
  // api_key.02 (fixed 2026-10-20): an unreadable policy refuses (503) instead of reading as "no policy" (no IP allowlist, no limit).
  try { values = await SettingService.getByKeys(tenantId, keys); } catch {
    throw new AppError('API key policy is temporarily unavailable', 503, ErrorCode.INTERNAL_ERROR);
  }
  if (!values || typeof values !== 'object') throw new AppError('API key policy is temporarily unavailable', 503, ErrorCode.INTERNAL_ERROR);

  const num = (k: string) => {
    const n = parseInt(values[k] ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    maxActiveKeys: num(API_KEY_SETTING_KEYS.MAX_ACTIVE_KEYS),
    maxTtlDays: num(API_KEY_SETTING_KEYS.MAX_TTL_DAYS),
    requireExpiry: values[API_KEY_SETTING_KEYS.REQUIRE_EXPIRY] === 'true',
    tenantIpAllowlist: parseSubnetString(values[API_KEY_SETTING_KEYS.TENANT_IP_ALLOWLIST]),
    defaultRateLimitPerMinute: num(API_KEY_SETTING_KEYS.DEFAULT_RATE_LIMIT_PER_MINUTE),
    allowedScopes: (values[API_KEY_SETTING_KEYS.ALLOWED_SCOPES] ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  };
}

/** Phase 48 (D13): a new key expires; 90 days when the caller names no date, never more than 365 days out. */
export const KEY_DEFAULT_TTL_DAYS = 90;
export const KEY_MAX_TTL_DAYS = 365;

/** The furthest a new key may expire from now, in days: the platform's 365, or the tenant's lower `apiKeyMaxTtlDays`. */
export function maxKeyTtlDays(policy: { maxTtlDays: number }): number {
  return policy.maxTtlDays > 0 ? Math.min(policy.maxTtlDays, KEY_MAX_TTL_DAYS) : KEY_MAX_TTL_DAYS;
}

/** The 90-day default lifetime from now, clamped to the tenant's lower maximum (a new key that names no date, a reviewed legacy key). */
export function defaultKeyExpiry(policy: { maxTtlDays: number }, now: number = Date.now()): Date {
  return new Date(now + Math.min(KEY_DEFAULT_TTL_DAYS, maxKeyTtlDays(policy)) * DAY_MS);
}

/**
 * Validate and normalise the requested expiry of a NEW key against the platform's lifetime rule (phase 48, D13) and the
 * tenant's policy. Every new key expires: a missing expiry is now + 90 days (clamped to a lower tenant maximum), unless
 * the tenant requires the caller to name one (422). A date in the past or beyond the maximum lifetime is a 422.
 */
export function resolveExpiry(
  rawExpiresAt: string | undefined,
  policy: { maxTtlDays: number; requireExpiry: boolean },
): Date {
  const now = Date.now();
  const ceiling = new Date(now + maxKeyTtlDays(policy) * DAY_MS);

  if (!rawExpiresAt) {
    if (policy.requireExpiry) throw new AppError(ApiKeyMessages.EXPIRY_REQUIRED, 422, ErrorCode.VALIDATION_ERROR);
    return defaultKeyExpiry(policy, now);
  }
  const expiresAt = new Date(rawExpiresAt);
  if (expiresAt.getTime() <= now) throw new AppError(ApiKeyMessages.EXPIRY_IN_PAST, 422, ErrorCode.VALIDATION_ERROR);
  if (expiresAt.getTime() > ceiling.getTime()) throw new AppError(ApiKeyMessages.TTL_EXCEEDS_MAX, 422, ErrorCode.VALIDATION_ERROR);
  return expiresAt;
}

/** Serialises every write that can raise the tenant's active-key count. */
export const keyLimitLock = (tenantId: string) => `api_key:limit:${tenantId}`;

/** Call inside a transaction holding `keyLimitLock`, or two writers both pass the count. */
export async function assertUnderKeyLimit(
  tenantId: string,
  repo: Repository<ApiKeyEntity>,
  maxActiveKeys: number,
): Promise<void> {
  if (maxActiveKeys <= 0) return;
  const active = await repo.count({ where: { tenantId, isActive: true } });
  if (active >= maxActiveKeys) {
    throw new AppError(ApiKeyMessages.MAX_KEYS_REACHED, 422, ErrorCode.VALIDATION_ERROR);
  }
}
