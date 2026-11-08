import Logger from '@kuraykaraaslan-labs/logger';
import redis from '@kuraykaraaslan-labs/redis';
import type { FeatureAccessResult } from './feature_gate.types';

const FEATURE_CACHE_PREFIX = 'feature:sub:';
const FEATURE_CACHE_TTL = 300;

export function featureCacheKey(tenantId: string): string {
  return `${FEATURE_CACHE_PREFIX}${tenantId}`;
}

export interface CachedFeatureState {
  status: string;
  gracePeriodEndsAt: string | null;
  features: Array<{ key: string; type: string; value: string }>;
}

/**
 * Tenants whose last purge could not reach Redis (feature_gate.09, fixed 2026-10-20), with the instant of that failure. A cached
 * verdict written at or before it is ignored (and dropped when Redis answers again), so a revoked entitlement is not served for the
 * rest of the TTL from a cache the purge could not reach. Process-local and bounded by the TTL; each failure is also logged.
 */
const failedPurges = new Map<string, number>();

/** The cached verdict only when it has the shape this module writes (feature_gate.08, fixed 2026-10-20); anything else is a miss. */
function isCachedState(v: unknown): v is CachedFeatureState & { cachedAt?: number } {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o.status === 'string'
    && (o.gracePeriodEndsAt === null || typeof o.gracePeriodEndsAt === 'string')
    && Array.isArray(o.features)
    && o.features.every((f) => !!f && typeof f === 'object'
      && typeof (f as Record<string, unknown>).key === 'string'
      && typeof (f as Record<string, unknown>).type === 'string'
      && typeof (f as Record<string, unknown>).value === 'string');
}

export async function getFeatureCache(tenantId: string): Promise<CachedFeatureState | null> {
  try {
    const raw = await redis.get(featureCacheKey(tenantId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCachedState(parsed)) {
      // A wrong-shaped entry is recomputed from the source (and overwritten) instead of failing every check for the whole TTL.
      await redis.del(featureCacheKey(tenantId)).catch(() => 0);
      return null;
    }
    const failedAt = failedPurges.get(tenantId);
    if (failedAt !== undefined) {
      if (Date.now() - failedAt > FEATURE_CACHE_TTL * 1000) failedPurges.delete(tenantId);
      else if ((parsed.cachedAt ?? 0) <= failedAt) {
        await redis.del(featureCacheKey(tenantId)).then(() => failedPurges.delete(tenantId)).catch(() => 0);
        return null;
      }
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function setFeatureCache(
  tenantId: string,
  status: string,
  gracePeriodEndsAt: Date | null | undefined,
  features: Array<{ key: string; type: string; value: string }>,
): Promise<void> {
  try {
    await redis.set(
      featureCacheKey(tenantId),
      JSON.stringify({ status, gracePeriodEndsAt: gracePeriodEndsAt?.toISOString() ?? null, features, cachedAt: Date.now() }),
      'EX',
      // feature_gate.06: never outlive the grace end the verdict relied on.
      gracePeriodEndsAt
        ? Math.max(1, Math.min(FEATURE_CACHE_TTL, Math.ceil((gracePeriodEndsAt.getTime() - Date.now()) / 1000)))
        : FEATURE_CACHE_TTL,
    );
  } catch (err) {
    Logger.warn(`Feature cache set failed for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function invalidateFeatureCache(tenantId: string): Promise<void> {
  try {
    await redis.del(featureCacheKey(tenantId));
    failedPurges.delete(tenantId);
  } catch (err) {
    failedPurges.set(tenantId, Date.now());
    Logger.warn(`Feature cache invalidation failed for tenant ${tenantId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Best-effort audit trail of gate decisions.
 *
 * `audit_log` is reached by a **dynamic** import and is deliberately absent from
 * this module's `requires`. Declaring it would close a cycle in the activation
 * graph — `audit_log` requires `common`, and `common`'s own chain runs
 * `common → tenant_branding → storage → feature_gate` — so the edge inverts.
 * Recorded in ACCEPTED_FORWARD_DRIFT alongside the other documented inversions
 * (DUP-01 step 5). The underlying oddity is `common` not being a leaf, which is
 * MIS-02's known debt, not something this module can fix.
 *
 * Fire-and-forget by design: a gate decision must not wait on, or be failed by,
 * its own audit row.
 */
/**
 * feature_gate.01 (fixed 2026-10-20): identical decisions (tenant, key, verdict) are audited at most once per window. Every check,
 * cached or denied, used to enqueue an audit row that takes the tenant's chain lock, so a hot gate multiplied audit rows and lock
 * traffic. A changed verdict is always written.
 */
const AUDIT_WINDOW_MS = 60_000;
const AUDIT_MEMO_MAX = 10_000;
const lastAudited = new Map<string, number>();

function shouldAudit(tenantId: string, result: FeatureAccessResult): boolean {
  const key = `${tenantId}\u0000${result.featureKey}\u0000${result.allowed ? 1 : 0}\u0000${result.type}`;
  const now = Date.now();
  const last = lastAudited.get(key);
  if (last !== undefined && now - last < AUDIT_WINDOW_MS) return false;
  if (lastAudited.size >= AUDIT_MEMO_MAX) lastAudited.clear();
  lastAudited.set(key, now);
  return true;
}

export function logFeatureAccess(tenantId: string, result: FeatureAccessResult): void {
  if (!shouldAudit(tenantId, result)) return;
  import('@kuraykaraaslan-labs/audit_log/server/audit_log.service')
    .then(({ default: AuditLogService }) => AuditLogService.log({
      tenantId,
      actorType: 'SYSTEM',
      action: 'feature.access.checked',
      resourceType: 'PlanFeature',
      resourceId: result.featureKey,
      metadata: result as object,
    }))
    .catch((err) =>
      Logger.error(`Feature access audit log failed: ${err instanceof Error ? err.message : String(err)}`)
    );
}

/** Test seam: forget the audit de-duplication window and the failed-purge markers (process-local state). */
export function resetFeatureGateMemos(): void {
  lastAudited.clear();
  failedPurges.clear();
}
