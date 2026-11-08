/**
 * What the PLAN adds to telemetry ingest (observability phase 16): a daily volume quota, a data-region guard and usage metering.
 * Called from `DefaultTelemetryLimits.admitIngest` after the request-rate check, so the order is rate → region → quota → meter.
 *
 * Nothing here refuses unless a plan declared `TELEMETRY_MB_PER_DAY` or the workspace set a data region, and every dependency
 * (the gate, the counter, the settings) fails OPEN: a billing or cache outage must not drop a customer's telemetry.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { OBSERVABILITY_LIMIT_KEYS as K } from '../observability.limit-keys';
import { limitOf } from '../observability.limits';
import { flushAllUsage, telemetryBytesBuffer } from '../observability.metering';
import { dataRegionOf } from '../observability.region';
import { redisCall } from '../observability.redis-guard';
import { refusalDetails, refusalForLimit, refusalForReason } from '../observability.refusals';
import type { Signal } from './telemetry.types';

const MB = 1024 * 1024;
const REGION_CACHE_MS = 60_000;
const DAY_MS = 86_400_000;

export interface PlanGuardDeps {
  /** Add `bytes` to the tenant's counter for this UTC day and return the new total. */
  addDaily(tenantId: string, day: string, bytes: number): Promise<number>;
  /** Take back what `addDaily` added (a refused request must not use the quota). */
  subDaily(tenantId: string, day: string, bytes: number): Promise<void>;
  /** The same counter for the logs signal alone (the log-volume limit). */
  addDailyLogs(tenantId: string, day: string, bytes: number): Promise<number>;
  subDailyLogs(tenantId: string, day: string, bytes: number): Promise<void>;
  regionOf(tenantId: string): Promise<string | null>;
  thisRegion(): string | null | Promise<string | null>;
  now(): Date;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const counterKey = (tenantId: string, day: string) => `obs:telemetry_bytes:${tenantId}:${day}`;
const logCounterKey = (tenantId: string, day: string) => `obs:telemetry_log_bytes:${tenantId}:${day}`;

const defaultDeps: PlanGuardDeps = {
  async addDaily(tenantId, day, bytes) {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    const key = counterKey(tenantId, day);
    const total = await redisCall(() => redis.incrby(key, bytes));
    // Two days, not one: a request at 23:59:59 must not lose its counter before the day it belongs to is over.
    if (total === bytes) await redisCall(() => redis.expire(key, 2 * 86_400));
    return total;
  },
  async subDaily(tenantId, day, bytes) {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    await redisCall(() => redis.decrby(counterKey(tenantId, day), bytes));
  },
  async addDailyLogs(tenantId, day, bytes) {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    const key = logCounterKey(tenantId, day);
    const total = await redisCall(() => redis.incrby(key, bytes));
    if (total === bytes) await redisCall(() => redis.expire(key, 2 * 86_400));
    return total;
  },
  async subDailyLogs(tenantId, day, bytes) {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    await redisCall(() => redis.decrby(logCounterKey(tenantId, day), bytes));
  },
  async regionOf(tenantId) {
    // The fleet directory's home region when it answers, the workspace setting otherwise (observability.region.ts); both fail open.
    return (await dataRegionOf(tenantId)).region;
  },
  async thisRegion() {
    // Loaded here, not at the top: this module is reached from the telemetry limits, which pure unit tests load without the env.
    const { env } = await import('@kuraykaraaslan-labs/env');
    return (env as { DEPLOYMENT_REGION?: string }).DEPLOYMENT_REGION?.trim() || null;
  },
  now: () => new Date(),
};

let deps: PlanGuardDeps = defaultDeps;
/** Test seam. */
export function setPlanGuardDeps(d?: Partial<PlanGuardDeps>): void { deps = d ? { ...defaultDeps, ...d } : defaultDeps; }

const regionCache = new Map<string, { at: number; region: string | null }>();
export function resetRegionCache(): void { regionCache.clear(); }

async function cachedRegion(tenantId: string): Promise<string | null> {
  const hit = regionCache.get(tenantId);
  const now = deps.now().getTime();
  if (hit && now - hit.at < REGION_CACHE_MS) return hit.region;
  let region: string | null = null;
  try { region = await deps.regionOf(tenantId); } catch { /* settings unavailable → no constraint */ }
  regionCache.set(tenantId, { at: now, region });
  return region;
}

const normalise = (r: string) => r.trim().toLowerCase();

/** Bytes are metered in one-minute aggregates per tenant: an event per request would make metering the biggest writer in the system. */
export async function flushTelemetryUsage(): Promise<void> { await flushAllUsage({ all: true }); }

export async function admitAgainstPlan(tenantId: string, signal: Signal, info: { bytes: number }): Promise<void> {
  // Residency: telemetry that arrives in the wrong region is refused, never stored here and never copied elsewhere.
  const required = await cachedRegion(tenantId);
  let here: string | null = null;
  if (required) { try { here = (await deps.thisRegion()) ?? null; } catch { /* unknown region: cannot judge, does not refuse */ } }
  if (required && here && normalise(required) !== normalise(here)) {
    throw new AppError('This workspace keeps its observability data in another region.', 403, ErrorCode.FORBIDDEN, { details: { reason: 'data_region', required, region: here, ...refusalDetails(refusalForReason('data_region')) } });
  }

  // A signal the plan does not include at all: `0` is "not part of the plan" (metric series), refused without touching a counter.
  if (signal === 'metrics' && (await limitOf(tenantId, K.ACTIVE_SERIES)) === 0) {
    throw new AppError('Metrics are not part of your plan.', 403, ErrorCode.FORBIDDEN, {
      details: { reason: 'active_series', key: K.ACTIVE_SERIES, limit: 0, signal, ...refusalDetails(refusalForLimit(K.ACTIVE_SERIES)) },
    });
  }

  const now = deps.now();
  const day = dayKey(now);
  const retryAfter = () => Math.max(1, Math.ceil((Date.parse(`${day}T00:00:00Z`) + DAY_MS - now.getTime()) / 1000));

  // Log volume has its own number (a part of the total, not on top of it). Counted first so a refused request spends nothing of the total.
  let loggedBytes = false;
  if (signal === 'logs') {
    const logMb = await limitOf(tenantId, K.LOG_MB_PER_DAY);
    if (Number.isFinite(logMb)) {
      let logTotal: number | null = null;
      try { logTotal = await deps.addDailyLogs(tenantId, day, info.bytes); loggedBytes = true; } catch { /* counter unavailable -> fail open */ }
      if (logTotal !== null && logTotal > logMb * MB) {
        await deps.subDailyLogs(tenantId, day, info.bytes).catch(() => {});
        throw new AppError('Your plan\'s daily log volume is used up.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
          retryable: true, headers: { 'Retry-After': String(retryAfter()) },
          details: { reason: 'log_volume', key: K.LOG_MB_PER_DAY, limit: logMb, limitMb: logMb, signal, ...refusalDetails(refusalForReason('log_volume')) },
        });
      }
    }
  }

  const mb = await limitOf(tenantId, K.TELEMETRY_MB_PER_DAY);
  if (Number.isFinite(mb)) {
    let total: number | null = null;
    try { total = await deps.addDaily(tenantId, day, info.bytes); } catch { /* counter unavailable -> fail open */ }
    if (total !== null && total > mb * MB) {
      await deps.subDaily(tenantId, day, info.bytes).catch(() => {});
      if (loggedBytes) await deps.subDailyLogs(tenantId, day, info.bytes).catch(() => {});
      throw new AppError('Your plan\'s daily telemetry volume is used up.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
        retryable: true, headers: { 'Retry-After': String(retryAfter()) },
        details: { reason: 'daily_quota', key: K.TELEMETRY_MB_PER_DAY, limitMb: mb, limit: mb, signal, ...refusalDetails(refusalForReason('daily_quota')) },
      });
    }
  }
  telemetryBytesBuffer.add(tenantId, info.bytes, { signal });
}
