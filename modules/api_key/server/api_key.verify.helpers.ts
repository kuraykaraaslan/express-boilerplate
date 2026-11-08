import 'reflect-metadata';
import { withSystemRLS } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import { ApiKey as ApiKeyEntity } from './entities/api_key.entity';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import Logger from '@kuraykaraaslan-labs/logger';
import { env } from '@kuraykaraaslan-labs/env';
import { DEFAULT_TRUSTED_PROXY_HOPS, clientIpFromForwardedFor } from '@kuraykaraaslan-labs/ip_subnet';
import { ANOMALY_DORMANCY_DAYS, DAY_MS } from './api_key.policy';
import { recordKeyStrike } from './api_key.strikes';

/**
 * Audit a rejected verification. Best-effort, fire-and-forget. When the key
 * hash matched no row we have no tenant, so the event is recorded against the
 * platform (root) tenant.
 *
 * Phase 55 00.5: a refusal of a KNOWN key is also a strike on that key (api_key.strikes.ts; only the reasons that say something
 * about the holder count). The address is recorded on the row, never struck (38 L-4).
 */
export function auditFailure(reason: string, tenantId: string | null, ip?: string | null, apiKeyId?: string): void {
  if (apiKeyId && tenantId) void recordKeyStrike(apiKeyId, tenantId, reason);
  AuditLogService.log({
    tenantId: tenantId ?? ROOT_TENANT_ID,
    actorType: 'API_KEY',
    action: 'api_key.verify.failed',
    resourceType: 'ApiKey',
    resourceId: apiKeyId ?? null,
    ipAddress: ip ?? null,
    metadata: { reason },
  }).catch(() => {});
}

/**
 * api_key.02 (fixed 2026-10-20): the platform default when a tenant set no per-key limit (a leaked key is no longer unthrottled), and
 * a per-process window used while Redis cannot count, so a Redis outage degrades the limit instead of lifting it.
 */
export const PLATFORM_DEFAULT_RATE_LIMIT_PER_MINUTE = 1000;
const localWindows = new Map<string, number>();
/** Test seam: forget the per-process windows (they are process state, so one test's outage would otherwise count in the next). */
export function resetLocalRateWindows(): void { localWindows.clear(); }

/** Per-key sliding-window rate limit. Returns true when the call is allowed. */
export async function withinRateLimit(apiKeyId: string, limitPerMinute: number): Promise<boolean> {
  const limit = limitPerMinute > 0 ? limitPerMinute : PLATFORM_DEFAULT_RATE_LIMIT_PER_MINUTE;
  const windowKey = `api_key:rl:${apiKeyId}:${Math.floor(Date.now() / 60_000)}`;
  try {
    const count = await redis.incrby(windowKey, 1);
    if (count === 1) await redis.expire(windowKey, 70).catch(() => {});
    return count <= limit;
  } catch {
    // Redis cannot count: a per-process window keeps the limit (never unlimited, never a lock-out of the first calls).
    if (localWindows.size > 10_000) localWindows.clear();
    const count = (localWindows.get(windowKey) ?? 0) + 1;
    localWindows.set(windowKey, count);
    return count <= limit;
  }
}

/**
 * One alert per key and address per window. A refused call does not stamp the key's row (the tenant key lane stamps only a
 * call it let through), so a dormant key presented from a new address stays dormant while its calls are refused: without
 * this bound every refused call would raise the alert again, up to the key's rate limit (review 2026-10-28).
 */
export const ANOMALY_ALERT_WINDOW_SECONDS = 60 * 60;
const localAlerts = new Map<string, number>();
/** Test seam: forget the per-process alert windows. */
export function resetLocalAnomalyAlerts(): void { localAlerts.clear(); }

/** True for the first alert of this key from this address in the window (Redis, else a per-process window). */
async function firstAlertInWindow(apiKeyId: string, ip: string): Promise<boolean> {
  const key = `api_key:anomaly:${apiKeyId}:${ip}`;
  try {
    return (await redis.set(key, '1', 'EX', ANOMALY_ALERT_WINDOW_SECONDS, 'NX')) === 'OK';
  } catch {
    // Redis cannot answer: a per-process window still bounds the alerts (never none, never one per call).
    const now = Date.now();
    if (localAlerts.size > 10_000) localAlerts.clear();
    const until = localAlerts.get(key);
    if (until !== undefined && until > now) return false;
    localAlerts.set(key, now + ANOMALY_ALERT_WINDOW_SECONDS * 1000);
    return true;
  }
}

/** Flag a usage anomaly without blocking the request (the caller does not await it). */
export async function detectAnomaly(row: ApiKeyEntity, ip: string | null): Promise<void> {
  if (!ip || ip === 'unknown') return;
  const lastIp = row.lastUsedIp;
  const lastAt = row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : 0;
  const dormantMs = ANOMALY_DORMANCY_DAYS * DAY_MS;
  const newIp = !!lastIp && lastIp !== ip;
  const dormant = lastAt > 0 && Date.now() - lastAt > dormantMs;
  if (!newIp || !dormant) return;
  if (!(await firstAlertInWindow(row.apiKeyId, ip))) return;
  Logger.warn(`[ApiKey] anomaly: key=${row.apiKeyId} used from new IP ${ip} after ${ANOMALY_DORMANCY_DAYS}d dormancy (prev ${lastIp})`);
  AuditLogService.log({
    tenantId: row.tenantId,
    actorType: 'API_KEY',
    action: 'api_key.anomaly.detected',
    resourceType: 'ApiKey',
    resourceId: row.apiKeyId,
    ipAddress: ip,
    metadata: { previousIp: lastIp, dormantDays: ANOMALY_DORMANCY_DAYS },
  }).catch(() => {});
  // Phase 55 00.4: its own event. It used to ride the generic `api_key.updated`, so an integration that wanted the alert had to take
  // every rename and deactivation too, and one that took `api_key.updated` for edits got a security finding it did not expect.
  WebhookService.dispatchEvent(row.tenantId, 'api_key.anomaly_detected', {
    apiKeyId: row.apiKeyId,
    anomaly: 'dormant_new_ip',
    ip,
    previousIp: lastIp,
    dormantDays: ANOMALY_DORMANCY_DAYS,
  }).catch(() => {});
}

/** Persist lastUsedAt / lastUsedIp and bump the usage counter. */
export async function recordUsage(apiKeyId: string, ip: string | null): Promise<void> {
  try {
    // One statement: the counter is bumped in SQL, so concurrent requests never
    // lose an increment. Keyed by the (globally unique) key id from verify.
    await withSystemRLS((qr) => qr.manager.getRepository(ApiKeyEntity).update(
      { apiKeyId },
      { lastUsedAt: new Date(), lastUsedIp: ip ?? null, usageCount: () => '"usageCount" + 1' } as never,
    ));
    // The cached row carries a stale counter/lastUsed — drop it so the next
    // read reflects reality. (Verification still works off the hash cache.)
    await redis.del(`api_key:id:${apiKeyId}`).catch(() => {});
  } catch {
    /* bookkeeping is best-effort */
  }
}

/**
 * The caller's IP for the key allowlists, read exactly as the tenant IP lists read it (tenant_session.client-ip.ts):
 * X-Forwarded-For through `TRUSTED_PROXY_HOPS` trusted proxies, the entry that many places from the right. The leftmost
 * entry and X-Real-IP are not read: behind an appending proxy the client writes them, and could name an allowlisted
 * address (review 2026-10-18).
 */
export function ipFromHeaders(headers: { get: (name: string) => string | null }): string | null {
  return clientIpFromForwardedFor(headers.get('x-forwarded-for'), env.TRUSTED_PROXY_HOPS ?? DEFAULT_TRUSTED_PROXY_HOPS);
}
