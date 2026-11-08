import 'reflect-metadata';
import { env } from '@kuraykaraaslan-labs/env';
import redis from '@kuraykaraaslan-labs/redis';
import { ipListVerdict } from '@kuraykaraaslan-labs/ip_subnet';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { reportRefusal } from '@kuraykaraaslan-labs/common/server/refusal-sink';
import TenantAuthMessages from './tenant_session.messages';
import type { TenantSessionRequestContext } from './tenant_session.types';

export const TENANT_CACHE_TTL = env.TENANT_CACHE_TTL ?? (60 * 5);

// Auth-failure circuit breaker (S2, decided 2026-10-21: per caller). It used to be one counter per tenant: 50 refusals a
// minute from anybody, a signed-in stranger included, locked every member of the tenant out with 429. It now counts per CALLER
// in the tenant, with a tenant-wide counter kept only as a much higher backstop:
//  - the caller is the authenticated user (`u:<userId>`), else the client address from the trusted hops (`ip:<addr>`), else
//    the one shared bucket of address-less requests (`unknown`, limiter.04);
//  - one caller is refused after AUTH_FAIL_CALLER_THRESHOLD failures in the window: a stranger locks out only themself;
//  - the tenant is refused after AUTH_FAIL_TENANT_BACKSTOP failures in the window from all callers together (20x the per-caller
//    limit): a distributed flood from many accounts or addresses is still bounded and cannot hammer the tenant's database.
// The numbers are on the safe side: a member who really hits ten refusals a minute is retrying something they are not allowed
// to do, and loses only one minute; the backstop is four times the old per-tenant limit, never reachable by one caller.
const AUTH_FAIL_WINDOW = 60;                // seconds
export const AUTH_FAIL_CALLER_THRESHOLD = 10;      // failures per caller per window before that caller is refused
export const AUTH_FAIL_TENANT_BACKSTOP = 20 * AUTH_FAIL_CALLER_THRESHOLD;   // failures per tenant per window (all callers)

/** Who a failure is counted against: the signed-in user, else the client address, else the shared address-less bucket. */
export interface AuthFailureCaller { userId?: string | null; ip?: string | null }
export function authFailureCallerKey(caller?: AuthFailureCaller): string | null {
  if (!caller) return null;
  if (caller.userId) return `u:${caller.userId}`;
  if (caller.ip && caller.ip !== 'unknown') return `ip:${caller.ip}`;
  return 'unknown';
}
const tenantKey = (tenantId: string) => `tenant:authfail:${tenantId}`;
const callerKey = (tenantId: string, caller: string) => `tenant:authfail:${tenantId}:${caller}`;

/**
 * Resolve the cache TTL for a tenant's session, honouring the per-tenant
 * `sessionTimeout` security setting (interpreted as minutes). The cache must
 * never outlive the tenant's declared session window, so we cap it at the
 * smaller of the global TTL and the tenant policy.
 */
export async function resolveSessionTtl(tenantId: string): Promise<number> {
  try {
    const s = await SettingService.getByKeys(tenantId, ['sessionTimeout']);
    const minutes = Number(s.sessionTimeout);
    if (Number.isFinite(minutes) && minutes > 0) {
      return Math.max(30, Math.min(TENANT_CACHE_TTL, Math.floor(minutes * 60)));
    }
  } catch { /* fall through to global default */ }
  return TENANT_CACHE_TTL;
}

/**
 * Enforce the tenant's `ipBlacklist` (deny if matched) then `ipWhitelist`
 * (deny if set and not matched) against the request IP. No-op when neither
 * list is configured. Both lists take addresses and CIDR blocks, IPv4 and IPv6,
 * separated by commas, spaces or newlines. A missing IP never matches a
 * non-empty whitelist (fail closed), and settings that cannot be read refuse the
 * request too: the lists may be set, and a store outage must not lift them.
 * Refuses with 403 `TENANT_IP_NOT_ALLOWED`.
 *
 * Only the tenant's OWN lists count: unlike most settings these two never fall
 * back to the ROOT tenant's value. ROOT's lists guard the platform's own console;
 * inherited, one ROOT whitelist would refuse every member of every tenant that
 * has none of its own.
 *
 * The settings come from SettingService's cached per-tenant map (one Redis
 * GET, no database read on a warm cache), so this runs on every request.
 * Callers pass the IP from `trustedClientIp` (tenant_session.client-ip.ts).
 */
export async function assertIpAllowed(tenantId: string, ip: string | null | undefined): Promise<void> {
  let blacklist: string | undefined;
  let whitelist: string | undefined;
  try {
    const own = await SettingService.getAll(tenantId);
    blacklist = own.find((s) => s.key === 'ipBlacklist')?.value;
    whitelist = own.find((s) => s.key === 'ipWhitelist')?.value;
  } catch {
    // fail closed: an unreadable store must not lift a configured whitelist
    void reportIpDenied(tenantId, ip, 'settings_unreadable');
    throw new AppError(TenantAuthMessages.IP_NOT_ALLOWED, 403, ErrorCode.TENANT_IP_NOT_ALLOWED);
  }

  // One answer for both verdicts: telling `blocked` from `not_allowed` would let a caller map which list exists and
  // which of their addresses it names.
  const verdict = ipListVerdict(ip, blacklist, whitelist);
  if (verdict !== 'allowed') {
    void reportIpDenied(tenantId, ip, verdict);
    throw new AppError(TenantAuthMessages.IP_NOT_ALLOWED, 403, ErrorCode.TENANT_IP_NOT_ALLOWED);
  }
}

/**
 * Phase 55 00 §0.3 (P-3): the tenant's list refusal on the record (`security.tenant_ip_denied`), counted per address and minute. The verdict
 * (`blocked` / `not_allowed`) is kept for the tenant's own audit view; the caller's answer stays the one undistinguished 403.
 */
function reportIpDenied(tenantId: string, ip: string | null | undefined, verdict: string): Promise<void> {
  return reportRefusal({
    action: 'security.tenant_ip_denied', tenantId, ipAddress: ip ?? null, key: ip || 'unknown',
    resourceType: 'tenant', resourceId: tenantId, metadata: { verdict },
  });
}

/**
 * Enforce the tenant's `twoFactorRequired` policy at the session layer: when
 * the tenant mandates 2FA the request must carry a verified second factor.
 */
export async function assert2faSatisfied(tenantId: string, ctx: TenantSessionRequestContext): Promise<void> {
  let required = false;
  try {
    const s = await SettingService.getByKeys(tenantId, ['twoFactorRequired']);
    required = s.twoFactorRequired === 'true';
  } catch { return; }
  if (required && ctx.mfaVerified !== true) {
    throw new AppError(TenantAuthMessages.TWO_FACTOR_REQUIRED, 403, ErrorCode.FORBIDDEN);
  }
}

// MS-36: the per-request concurrent-session check (`assertConcurrentLimit`, a Redis set per member that answered 429 to the
// newest session over `maxConcurrentSessions`) is removed. The key is enforced once, when a session is issued, by
// user_session's `enforceSessionCap` (the oldest sessions of the user in the tenant end), together with auth's
// `singleSessionOnly` (a cap of 1).

/**
 * Impossible-travel / geo anomaly detection. Compares the request country to
 * the last-seen country for this member; a mismatch within a short window is
 * recorded as a high-severity audit signal (non-blocking by design — alerting,
 * not lockout, is the documented control).
 */
export async function checkGeoAnomaly(
  tenantId: string,
  userId: string,
  ctx: TenantSessionRequestContext,
): Promise<boolean> {
  if (!ctx.country) return false;
  const key = `tenant:geo:${tenantId}:${userId}`;
  try {
    const prev = await redis.get(key);
    await redis.setex(key, 3600, ctx.country);
    if (prev && prev !== ctx.country) {
      await AuditLogService.log({
        tenantId, actorId: userId, actorType: 'USER', action: 'tenant.session.geo_anomaly',
        severity: 'high', resourceType: 'tenant', resourceId: tenantId,
        ipAddress: ctx.ip ?? null, userAgent: ctx.userAgent ?? null,
        metadata: { previousCountry: prev, currentCountry: ctx.country },
      });
      return true;
    }
  } catch { /* fail-open */ }
  return false;
}

/** Trip-check the auth-failure breaker for this caller in this tenant (S2: per caller, plus the tenant backstop). */
export async function assertCircuitClosed(tenantId: string, caller?: AuthFailureCaller): Promise<void> {
  const tripped = () => new AppError(TenantAuthMessages.TOO_MANY_AUTH_FAILURES, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
  // Phase 55 00 §0.3 (P-3): the open breaker on the record (`security.auth_circuit_open`), counted per caller (or for the tenant's backstop) and minute.
  const report = (scope: 'caller' | 'tenant', key: string, failures: number) => void reportRefusal({
    action: 'security.auth_circuit_open', tenantId, key: `${scope}:${key}`,
    actorId: scope === 'caller' ? caller?.userId ?? null : null, ipAddress: caller?.ip && caller.ip !== 'unknown' ? caller.ip : null,
    resourceType: 'tenant', resourceId: tenantId,
    metadata: { scope, failures, threshold: scope === 'caller' ? AUTH_FAIL_CALLER_THRESHOLD : AUTH_FAIL_TENANT_BACKSTOP },
  });
  try {
    const who = authFailureCallerKey(caller);
    if (who) {
      const mine = Number(await redis.get(callerKey(tenantId, who))) || 0;
      if (mine >= AUTH_FAIL_CALLER_THRESHOLD) { report('caller', who, mine); throw tripped(); }
    }
    const all = Number(await redis.get(tenantKey(tenantId))) || 0;
    if (all >= AUTH_FAIL_TENANT_BACKSTOP) { report('tenant', tenantId, all); throw tripped(); }
  } catch (e) {
    if (e instanceof AppError) throw e; // honour a tripped breaker
    // Fail open on a Redis error (D250, docs/audits/2026-11-03-redis-outage.md §6): this brakes membership probing by a person who
    // is already signed in; the membership itself is read from the database, and the sign-in limiter in front fails closed.
  }
}

async function bump(key: string): Promise<void> {
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, AUTH_FAIL_WINDOW);
}

/** Count one auth failure against the caller and the tenant backstop (windowed). */
export async function recordAuthFailure(tenantId: string, caller?: AuthFailureCaller): Promise<void> {
  try {
    await bump(tenantKey(tenantId));
    const who = authFailureCallerKey(caller);
    if (who) await bump(callerKey(tenantId, who));
  } catch { /* fail open: a failure Redis cannot count is not counted (see assertCircuitClosed) */ }
}
