import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { withinRedisBound } from './limiter.service';
import { LIMITER_SETTING_KEYS } from './limiter.setting.keys';

/**
 * The installation's rate-limit and ban tightening (2026-10-27), read from the ROOT tenant: the limits protect the whole installation
 * (one client address is nobody's tenant), so they are the platform operator's and a value in any other tenant is never read. Every key
 * can only make the built-in protection STRICTER; unset, a value at or beyond the built-in one, junk, or a failed read keeps it exactly.
 * A tenant's own plan allowance stays plan data (feature_gate `api_rate_limit`), untouched here.
 *
 * - `limiterAuthPerMinute`: the shared `auth` bucket of one client address (login, OTP, captcha, reset), was the constant 20 a minute
 *   (`LIMITS.auth`). 5..20.
 * - `limiterLoginPerMinute`: the login endpoint's own budget, spent on top of the `auth` bucket, was 10 a minute
 *   (`AUTH_ENDPOINT_LIMITS.login`, or `AUTH_LIMIT_LOGIN`). 3..10; the lower of this and the built-in (or env) budget applies.
 * - `limiterApiPerMinute`: the `api` bucket of an anonymous client address, was the constant 120 a minute (`LIMITS.api`). 30..120. A
 *   signed-in person's own bucket and the address ceiling are not changed.
 * - `limiterStrikeThreshold`: failed human sign-ins from one address (any account) within 10 minutes that ban it, was the constant 10
 *   (`STRIKE_THRESHOLD`). 3..10.
 * - `limiterBanBaseMinutes`: the first automatic ban of an address (doubled per repeat, at most 7 days), was the constant 60 minutes
 *   (`BAN_BASE_SECONDS`). 60..10080; a manual ban without a length takes it too.
 *
 * Hot path: the limiter runs on every request, so the values are cached in process for `LIMITER_POLICY_CACHE_MS` (like the global IP
 * blocklist, limiter.global-blocklist.ts). The first read of a process is awaited for at most `FIRST_READ_TIMEOUT_MS` (then the
 * built-in values); later reads answer from the cache at once and refresh it in the background, one read at a time. A read that fails
 * keeps the last values read (the built-in ones before any). The settings service never calls the limiter, so the read cannot recurse.
 */

export const LIMITER_POLICY_CACHE_MS = 30_000;
export const FIRST_READ_TIMEOUT_MS = 250;

/** The range of each lower-only key: `ceiling` is the built-in value (a value at or above it changes nothing), `floor` the strictest. */
export const LOWER_ONLY_RANGES = {
  limiterAuthPerMinute: { floor: 5, ceiling: 20 },
  limiterLoginPerMinute: { floor: 3, ceiling: 10 },
  limiterApiPerMinute: { floor: 30, ceiling: 120 },
  limiterStrikeThreshold: { floor: 3, ceiling: 10 },
} as const;

/** The first automatic ban in minutes: `floor` is the built-in 60 (a value at or below it changes nothing), `ceiling` the longest ban. */
export const BAN_BASE_MINUTES_RANGE = { floor: 60, ceiling: 7 * 24 * 60 } as const;

/** null = the built-in value applies. */
export interface LimiterPolicy {
  authPerMinute: number | null;
  loginPerMinute: number | null;
  apiPerMinute: number | null;
  strikeThreshold: number | null;
  banBaseSeconds: number | null;
}

export const DEFAULT_LIMITER_POLICY: LimiterPolicy = Object.freeze({
  authPerMinute: null,
  loginPerMinute: null,
  apiPerMinute: null,
  strikeThreshold: null,
  banBaseSeconds: null,
});

const wholeNumber = (raw: string | null | undefined): number | null => {
  const v = (raw ?? '').trim();
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
};

/** A cap that can only lower a built-in value: null when unset, junk, or at or above the ceiling; below the floor reads as the floor. */
export function lowerOnlyCap(raw: string | null | undefined, floor: number, ceiling: number): number | null {
  const n = wholeNumber(raw);
  if (n === null || n >= ceiling) return null;
  return Math.max(floor, n);
}

/** A value that can only raise a built-in one: null when unset, junk, or at or below the floor; above the ceiling reads as the ceiling. */
export function raiseOnly(raw: string | null | undefined, floor: number, ceiling: number): number | null {
  const n = wholeNumber(raw);
  if (n === null || n <= floor) return null;
  return Math.min(ceiling, n);
}

export function parseLimiterPolicy(s: Record<string, string | null | undefined>): LimiterPolicy {
  const cap = (key: keyof typeof LOWER_ONLY_RANGES) => lowerOnlyCap(s[key], LOWER_ONLY_RANGES[key].floor, LOWER_ONLY_RANGES[key].ceiling);
  const banMinutes = raiseOnly(s.limiterBanBaseMinutes, BAN_BASE_MINUTES_RANGE.floor, BAN_BASE_MINUTES_RANGE.ceiling);
  return {
    authPerMinute: cap('limiterAuthPerMinute'),
    loginPerMinute: cap('limiterLoginPerMinute'),
    apiPerMinute: cap('limiterApiPerMinute'),
    strikeThreshold: cap('limiterStrikeThreshold'),
    banBaseSeconds: banMinutes === null ? null : banMinutes * 60,
  };
}

/** The stricter of a built-in value and a lower-only cap. */
export const capped = (builtIn: number, cap: number | null): number => (cap === null ? builtIn : Math.min(builtIn, cap));

let cache: { at: number; policy: LimiterPolicy } | null = null;
let inflight: Promise<LimiterPolicy> | null = null;

/** Drops the cached policy (tests; a process that must see a write at once). */
export function resetLimiterPolicyCache(): void {
  cache = null;
  inflight = null;
}

async function load(): Promise<LimiterPolicy> {
  try {
    // Loaded on use: the limiter's import graph stays as it was, and any failure keeps what the process had.
    const { default: SettingService } = await import('@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service');
    return parseLimiterPolicy((await SettingService.getByKeys(ROOT_TENANT_ID, [...LIMITER_SETTING_KEYS])) ?? {});
  } catch {
    return cache?.policy ?? DEFAULT_LIMITER_POLICY;
  }
}

function refresh(): Promise<LimiterPolicy> {
  if (!inflight) {
    const run = load().then((policy) => {
      if (inflight === run) cache = { at: performance.now(), policy };
      return policy;
    });
    inflight = run;
    void run.finally(() => { if (inflight === run) inflight = null; });
  }
  return inflight;
}

/** The installation's tightening, cached (see the header). Never throws. */
export async function getLimiterPolicy(): Promise<LimiterPolicy> {
  if (cache) {
    if (performance.now() - cache.at >= LIMITER_POLICY_CACHE_MS) void refresh();
    return cache.policy;
  }
  try {
    return await withinRedisBound(refresh(), FIRST_READ_TIMEOUT_MS);
  } catch {
    return DEFAULT_LIMITER_POLICY;
  }
}
