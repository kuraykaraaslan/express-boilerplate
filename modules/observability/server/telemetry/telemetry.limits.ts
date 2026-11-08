/**
 * What a tenant may do with the telemetry store, as an interface the platform wires to plans and metering (phase 16) without
 * `observability` importing `feature_gate` or `metering`. The default implementation is permissive on purpose: it caps the
 * size of one request and the request rate, and applies the plan's daily volume, data region and metering ONLY where a plan or the
 * workspace declared one (`telemetry.plan-guard.ts`). Wire a stricter one with `setTelemetryLimits`.
 *
 * Every method may be async and receives the tenant id verified from the ingest key or the session.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { DEFAULT_DECODE_LIMITS, type DecodeLimits } from './otlp.codec';
import { DEFAULT_SAMPLING, type TailSamplingPolicy } from './telemetry.sampling';
import { admitAgainstPlan } from './telemetry.plan-guard';
import type { Signal } from './telemetry.types';

export interface QueryCaps {
  /** Longest queried time range. */
  maxRangeMs: number;
  /** Most points a metric series may carry (`range / step`). */
  maxPoints: number;
  /** Most rows a log query may return. */
  maxLogRows: number;
  /** Most traces a search may return. */
  maxTraces: number;
  /** Most spans one trace view or service map may load. */
  maxSpans: number;
  /** Query requests a tenant may make per minute, all signals together. */
  queriesPerMinute: number;
}

export interface TelemetryLimits {
  /** Largest request body (as sent, possibly compressed) the tenant may ingest. */
  maxBodyBytes(tenantId: string, signal: Signal): number | Promise<number>;
  decode(tenantId: string, signal: Signal): DecodeLimits | Promise<DecodeLimits>;
  /** Called once per ingest request after authentication and before decoding. Throws an `AppError` (429, 402, 403) to refuse. */
  admitIngest(tenantId: string, signal: Signal, info: { bytes: number }): Promise<void>;
  sampling(tenantId: string): TailSamplingPolicy | Promise<TailSamplingPolicy>;
  queryCaps(tenantId: string): QueryCaps | Promise<QueryCaps>;
  /** Called once per query request. Throws an `AppError` to refuse. */
  admitQuery(tenantId: string): Promise<void>;
  /** Optional: how many ingest requests of this tenant the process may work on at once (default `DEFAULT_MAX_IN_FLIGHT`, see observability.concurrency.ts). */
  maxInFlight?(tenantId: string): number | Promise<number>;
}

/** The absolute ceiling for any request body, whatever a limits implementation says. */
export const HARD_MAX_BODY_BYTES = 16 * 1024 * 1024;

export const DEFAULT_QUERY_CAPS: QueryCaps = {
  maxRangeMs: 7 * 86_400_000, maxPoints: 1000, maxLogRows: 1000, maxTraces: 100, maxSpans: 5000, queriesPerMinute: 120,
};

export interface DefaultLimitsOptions {
  maxBodyBytes?: number;
  ingestRequestsPerMinute?: number;
  caps?: Partial<QueryCaps>;
  decode?: Partial<DecodeLimits>;
  sampling?: Partial<TailSamplingPolicy>;
}

/** A fixed-window counter per key through the shared limiter (`limiter` is fabric: always present, fail-open on a Redis outage). */
async function rateLimit(key: string, limit: number, tenantId: string): Promise<void> {
  const { check } = await import('@kuraykaraaslan-labs/limiter/server/limiter.service');
  const res = await check(key, 'api', { limit, tenantId });
  if (!res.success) {
    throw new AppError('Telemetry rate limit exceeded', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { retryable: true, headers: { 'Retry-After': String(res.retryAfter) } });
  }
}

export class DefaultTelemetryLimits implements TelemetryLimits {
  private readonly o: Required<Pick<DefaultLimitsOptions, 'maxBodyBytes' | 'ingestRequestsPerMinute'>> & DefaultLimitsOptions;

  constructor(opts: DefaultLimitsOptions = {}) {
    this.o = { maxBodyBytes: 4 * 1024 * 1024, ingestRequestsPerMinute: 600, ...opts };
  }

  maxBodyBytes(): number { return Math.min(this.o.maxBodyBytes, HARD_MAX_BODY_BYTES); }
  decode(): DecodeLimits { return { ...DEFAULT_DECODE_LIMITS, ...(this.o.decode ?? {}) }; }
  sampling(): TailSamplingPolicy { return { ...DEFAULT_SAMPLING, ...(this.o.sampling ?? {}) }; }
  queryCaps(): QueryCaps { return { ...DEFAULT_QUERY_CAPS, ...(this.o.caps ?? {}) }; }

  async admitIngest(tenantId: string, signal: Signal, info: { bytes: number }): Promise<void> {
    await rateLimit(`telemetry:ingest:${tenantId}:${signal}`, this.o.ingestRequestsPerMinute, tenantId);
    // The plan's half (phase 16): data region, daily volume, usage metering. Refuses nothing unless a plan or the workspace asked it to.
    await admitAgainstPlan(tenantId, signal, info);
  }

  admitQuery(tenantId: string): Promise<void> {
    return rateLimit(`telemetry:query:${tenantId}`, this.queryCaps().queriesPerMinute, tenantId);
  }
}

let current: TelemetryLimits = new DefaultTelemetryLimits();

export function getTelemetryLimits(): TelemetryLimits {
  return current;
}

/** The seam phase 16 uses to wire plan and metering limits. Pass `null` to restore the default. */
export function setTelemetryLimits(limits: TelemetryLimits | null): void {
  current = limits ?? new DefaultTelemetryLimits();
}
