import 'reflect-metadata';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import redis, { jitter, singleFlight } from '@kuraykaraaslan-labs/redis';
import { ApiKey as ApiKeyEntity } from './entities/api_key.entity';
import { SafeApiKey, SafeApiKeySchema } from './api_key.types';
import ApiKeyMessages from './api_key.messages';
import { scopeRequirementMet, type RequiredScope } from './api_key.enums';
import { ipMatchesAllowlist } from '@kuraykaraaslan-labs/ip_subnet';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { hashKey } from './api_key.crypto';
import { API_KEY_CACHE_TTL, NEG, apiKeyVersionKey, getNegativeCacheTtl, reviveCachedKey } from './api_key.cache';
import { noDropPending, openEntry, readGuarded, stampForWrite, stampOf, writeGuarded } from '@kuraykaraaslan-labs/session_end/server/session_end.cache-guard';
import { getTenantPolicy } from './api_key.policy';
import { keyStandingRefusal } from './api_key.membership';
import {
  auditFailure,
  detectAnomaly,
  ipFromHeaders,
  recordUsage,
  withinRateLimit,
  PLATFORM_DEFAULT_RATE_LIMIT_PER_MINUTE,
} from './api_key.verify.helpers';
import { effectiveKeyLimit, getKeyThrottle } from './api_key.strikes';
import { decoyTenantOf, noteDecoyKeyTouch } from './api_key.decoy';

/** Optional request context for {@link verify}. */
export interface VerifyContext {
  /** Source IP of the caller (for allowlist + anomaly detection). */
  ip?: string | null;
  /**
   * The tenant the key must belong to. A key of another tenant is refused with the generic 401 as soon as its row is known:
   * before the IP lists, the rate limit and the usage stamp, so it spends nothing of the key and leaves no trace on it.
   */
  tenantId?: string;
  /**
   * The caller stamps the use itself (`recordUsage`) once it let the request through: the key lane of the tenant guard
   * verifies a key before it knows whether the key holds the route's permission, and a refused call is not a use of the key.
   */
  deferUsage?: boolean;
}

/**
 * Verify a raw API key from an incoming request.
 * Updates lastUsedAt / lastUsedIp / usageCount on success, unless the caller defers that stamp (`ctx.deferUsage`).
 * Throws with a descriptive message on any failure.
 *
 * Negative cache: an unknown hash is cached as `__not_found__` for a short window to blunt
 * credential-stuffing — repeated guesses hit Redis, not the DB.
 *
 * When `ctx.ip` is supplied it is enforced against the key's IP allowlist (and
 * the tenant-wide default allowlist), feeds anomaly detection, and is recorded
 * as `lastUsedIp`.
 */
/** A required scope as one text for the decoy signal (an any-of reads `a|b`). */
const scopeText = (s: RequiredScope | undefined): string | undefined => (s === undefined ? undefined : typeof s === 'string' ? s : s.anyOf.join('|'));

export async function verify(rawKey: string, requiredScope?: RequiredScope, ctx?: VerifyContext): Promise<SafeApiKey> {
  const ip = ctx?.ip ?? null;
  const hash = hashKey(rawKey);
  const cacheKey = `api_key:hash:${hash}`;
  // Phase 55 02.5: the tenant's decoy key (api_key.decoy.ts) has no row, so it takes the unknown-key path below like any wrong key: the
  // same lookups, the same audit row, the same 401. Checked for every presented key of the generated shape, so a decoy costs what a wrong
  // key costs; a touch is one critical signal for the decoy's tenant (never awaited, never failing the answer: FWA-7).
  const decoyTenant = decoyTenantOf(rawKey);
  const refuseUnknown: () => never = () => {
    auditFailure('unknown_key', null, ip);
    if (decoyTenant) noteDecoyKeyTouch(decoyTenant, rawKey, ip, ctx?.tenantId, scopeText(requiredScope));
    throw new AppError(ApiKeyMessages.INVALID_KEY, 401, ErrorCode.UNAUTHORIZED);
  };

  // D253 (session_end.cache-guard.ts): the entry is read with the key's version (one round trip) and believed only when it is sealed
  // with the stamp of this read (the same Redis instance, the version not bumped since it was filled) and no cache drop is pending
  // for the key's tenant. Otherwise the database answers: a key revoked while Redis was away, or whose drop has not reached Redis
  // yet, is refused at once. The negative entry is believed as it is (it only ever refuses).
  const read = await readGuarded([cacheKey], [apiKeyVersionKey(hash)]);
  const cached = read?.values[0] ?? null;
  if (cached === NEG) refuseUnknown();

  let row: ApiKeyEntity | null = null;
  const sealed = openEntry(cached, stampOf(read));
  if (sealed !== undefined) {
    row = reviveCachedKey(sealed);
    if (!row) await redis.del(cacheKey).catch(() => {});
    // An object-shaped entry that is not a key row (no id or tenant) admits nobody: refused until it expires, never read as
    // a key whose policy is then looked up for an unknown tenant.
    else if (typeof row.apiKeyId !== 'string' || typeof row.tenantId !== 'string') refuseUnknown();
    else if (!(await noDropPending(row.tenantId))) row = null;
  }

  if (!row) {
    row = await singleFlight(cacheKey, async () => {
      // The tenant is not known yet — the key IS what identifies it — so the
      // lookup by hash is a deliberate cross-tenant read.
      const found = await withSystemRLS((qr) => qr.manager.getRepository(ApiKeyEntity).findOne({ where: { keyHash: hash } }));
      if (!found) {
        await redis.setex(cacheKey, jitter(await getNegativeCacheTtl()), NEG).catch(() => {});
        return null;
      }
      // Sealed with the version read BEFORE the database read: a revocation that commits in between bumps it, so this row is never
      // believed. Not cached at all while Redis is untrusted or a drop is pending for the tenant.
      const stamp = await stampForWrite(read);
      if (stamp && (await noDropPending(found.tenantId))) await writeGuarded(cacheKey, stamp, found, jitter(API_KEY_CACHE_TTL));
      return found;
    });
    if (!row) refuseUnknown();
  }
  // A decoy never authenticates, even if a row with its hash existed: refused as the unknown key it is.
  if (!row || decoyTenant) return refuseUnknown();

  // A key presented to a tenant that is not its own is the same 401 as an unknown key. The refusal is audited on the key's
  // own tenant (its owner learns the key travels), and nothing else about the key is touched.
  if (ctx?.tenantId && row.tenantId !== ctx.tenantId) {
    auditFailure('wrong_tenant', row.tenantId, ip, row.apiKeyId);
    throw new AppError(ApiKeyMessages.INVALID_KEY, 401, ErrorCode.UNAUTHORIZED);
  }

  if (!row.isActive) {
    auditFailure('inactive', row.tenantId, ip, row.apiKeyId);
    throw new AppError(ApiKeyMessages.KEY_INACTIVE, 401, ErrorCode.UNAUTHORIZED);
  }

  // api_key.21 (fixed 2026-10-20): expired AT expiresAt, the one definition rotate and the sweep use too.
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) {
    auditFailure('expired', row.tenantId, ip, row.apiKeyId);
    throw new AppError(ApiKeyMessages.KEY_EXPIRED, 401, ErrorCode.UNAUTHORIZED);
  }

  // S15 / api_key.03 (fixed 2026-10-20): the key's tenant must be ACTIVE, and its creator still an ACTIVE member unless an OWNER
  // marked it a service key. Read on every verification (never from the key cache), so a suspension or a removal takes effect at once.
  const refusal = await keyStandingRefusal(row);
  if (refusal) {
    auditFailure(refusal, row.tenantId, ip, row.apiKeyId);
    throw new AppError(ApiKeyMessages.INVALID_KEY, 401, ErrorCode.UNAUTHORIZED);
  }

  if (requiredScope && !scopeRequirementMet(row.scopes, requiredScope)) {
    auditFailure('insufficient_scope', row.tenantId, ip, row.apiKeyId);
    throw new AppError(ApiKeyMessages.INSUFFICIENT_SCOPE, 403, ErrorCode.FORBIDDEN);
  }

  // Per-key IP allowlist (cheap — lives on the row). Falls back to the
  // tenant-wide default allowlist only when the key declares none.
  let policy: Awaited<ReturnType<typeof getTenantPolicy>> | null = null;
  const perKeyAllowlist = row.ipAllowlist ?? [];
  if (perKeyAllowlist.length > 0) {
    if (!ipMatchesAllowlist(ip, perKeyAllowlist)) {
      auditFailure('ip_denied', row.tenantId, ip, row.apiKeyId);
      throw new AppError(ApiKeyMessages.IP_NOT_ALLOWED, 403, ErrorCode.FORBIDDEN);
    }
  } else {
    policy = await getTenantPolicy(row.tenantId);
    if (!ipMatchesAllowlist(ip, policy.tenantIpAllowlist)) {
      auditFailure('ip_denied', row.tenantId, ip, row.apiKeyId);
      throw new AppError(ApiKeyMessages.IP_NOT_ALLOWED, 403, ErrorCode.FORBIDDEN);
    }
  }

  // Per-key rate limit (tenant default policy). When the key carries its own allowlist the policy is read only for the
  // limit; an unreadable policy then falls back to the platform default limit (still a limit, never none), so a settings
  // outage neither lifts the throttle nor takes down keys whose network pin lives on the row.
  let limitPerMinute: number;
  if (policy) limitPerMinute = policy.defaultRateLimitPerMinute;
  else {
    try { limitPerMinute = (await getTenantPolicy(row.tenantId)).defaultRateLimitPerMinute; }
    catch { limitPerMinute = PLATFORM_DEFAULT_RATE_LIMIT_PER_MINUTE; }
  }
  // Phase 55 00.5: a key under a DECIDED throttle (api_key.strikes.ts `enforceKeyThrottle`) keeps at most the throttled ceiling until it
  // ends; a flag earned by refusals narrows nothing (the refused calls were refused anyway; only the rightful integration would pay).
  // Read on every verification (never from the key cache); a throttle that cannot be read is none (the limit above still holds).
  const throttle = await getKeyThrottle(row.apiKeyId);
  if (!(await withinRateLimit(row.apiKeyId, effectiveKeyLimit(limitPerMinute, throttle)))) {
    if (throttle?.enforced) {
      auditFailure('throttled', row.tenantId, ip, row.apiKeyId);
      throw new AppError(ApiKeyMessages.KEY_THROTTLED, 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
        retryable: true,
        headers: { 'Retry-After': String(Math.max(1, 60 - Math.floor((Date.now() % 60_000) / 1000))) },
      });
    }
    auditFailure('rate_limited', row.tenantId, ip, row.apiKeyId);
    throw new AppError(ApiKeyMessages.RATE_LIMITED, 429, ErrorCode.RATE_LIMIT_EXCEEDED);
  }

  // Anomaly detection: a dormant key suddenly used from a new IP (once per key and address per window, never awaited).
  void detectAnomaly(row, ip).catch(() => {});

  // Record usage (fire-and-forget — never block the request on bookkeeping), unless the caller stamps it once it let the
  // request through.
  if (!ctx?.deferUsage) void recordUsage(row.apiKeyId, ip);

  return SafeApiKeySchema.parse(row);
}

/**
 * Verify a raw API key from a request `Authorization: Bearer <key>` header,
 * optionally pinning the key to a tenant and enforcing a required scope.
 *
 * Used by SCIM 2.0 endpoints and other machine-to-machine integrations
 * where the caller cannot present a session cookie.
 *
 * Throws on missing/invalid header, mismatched tenant, or insufficient scope.
 */
export async function verifyFromAuthHeader(
  request: { headers: { get: (name: string) => string | null } },
  tenantId?: string,
  requiredScope?: RequiredScope,
  ctx?: VerifyContext,
): Promise<SafeApiKey> {
  const header = request.headers.get('authorization') || request.headers.get('Authorization');
  if (!header) throw new AppError(ApiKeyMessages.INVALID_KEY, 401, ErrorCode.UNAUTHORIZED);

  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new AppError(ApiKeyMessages.INVALID_KEY, 401, ErrorCode.UNAUTHORIZED);

  const rawKey = match[1].trim();
  if (!rawKey) throw new AppError(ApiKeyMessages.INVALID_KEY, 401, ErrorCode.UNAUTHORIZED);

  // Derive the source IP from the request when the caller did not supply one,
  // so SCIM / M2M callers get IP-allowlist + anomaly enforcement for free.
  // The tenant pin is checked inside verify, before the key's rate limit or usage is touched.
  const resolvedCtx: VerifyContext = {
    ...ctx,
    ip: ctx?.ip ?? ipFromHeaders(request.headers),
    ...(tenantId ? { tenantId } : {}),
  };

  return verify(rawKey, requiredScope, resolvedCtx);
}
