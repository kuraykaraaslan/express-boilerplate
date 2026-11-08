export const TTL_SECONDS = 32 * 24 * 60 * 60; // 32 days

/**
 * Lead decision D26 (tenant_usage.reseed.ts): settles a billed counter that has no TTL yet (one a count re-created), atomically:
 * the stored value of its period is added and its TTL set, once. A counter that has its TTL (settled, or gone again) is left
 * alone and 0 comes back. KEYS[1] the counter; ARGV[1] the stored value, ARGV[2] the TTL in seconds. Kept free of imports so the
 * test harness's fake Redis can run its twin (tests/security/fakes/redis.scripts.ts).
 */
export const SETTLE_SCRIPT = `if redis.call('TTL', KEYS[1]) ~= -1 then return 0 end
local stored = tonumber(ARGV[1])
if stored > 0 then redis.call('INCRBY', KEYS[1], stored) end
redis.call('EXPIRE', KEYS[1], ARGV[2])
return 1`;

/**
 * Metrics whose counter is a level, not a running total: it goes down as well as up (files deleted), so its stored value is
 * the counter's (net) value, written as it is; a counting metric's stored value only rises (flushToDb, D26).
 */
export const GAUGE_METRICS: ReadonlySet<string> = new Set(['storageBytes']);

export type TenantUsageMetric =
  | 'apiCalls'
  | 'aiTokens'
  | 'storageBytes'
  | 'emailSends'
  | 'smsSends'
  | 'webhookCalls';

export const METRICS: TenantUsageMetric[] = [
  'apiCalls',
  'aiTokens',
  'storageBytes',
  'emailSends',
  'smsSends',
  'webhookCalls',
];

export interface TenantUsageSnapshot {
  apiCalls: number;
  aiTokens: number;
  storageBytes: number;
  emailSends: number;
  smsSends: number;
  webhookCalls: number;
}

/** Current month key (YYYY-MM) in UTC, like {@link currentDay} and the cron / job flush month. */
export function currentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export function redisKey(tenantId: string, metric: string, month: string): string {
  return `tenant:${tenantId}:usage:${metric}:${month}`;
}

/** Current day key (YYYY-MM-DD) for daily-granularity counters. */
export function currentDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function dailyKey(tenantId: string, metric: string, day: string): string {
  return `tenant:${tenantId}:usage:${metric}:day:${day}`;
}

export function endpointKey(tenantId: string, month: string): string {
  return `tenant:${tenantId}:usage:endpoint:${month}`;
}
