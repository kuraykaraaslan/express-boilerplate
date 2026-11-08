/**
 * The telemetry store port (phase 17.1, ADR-0009). `observability` depends on this interface only; adapters live in
 * `./adapters/` and no code outside an adapter knows PromQL, LogQL or TraceQL.
 *
 * Rules every adapter must keep (the contract suite in `tests/backend.contract.ts` checks them):
 *  - The first argument is the tenant id, taken from a verified key or session. The adapter stamps it on what it writes and
 *    filters on it for every read. Reading, listing or deleting under tenant A never touches tenant B.
 *  - Unsupported operations throw `TelemetryUnsupportedError` (an explicit 501), never silently do nothing.
 *  - An unknown id (trace, tenant) is "not found" / empty, never an error that differs between "exists for another tenant"
 *    and "does not exist".
 */
import type { TailOptions } from './telemetry.tail';
import type {
  BackendCapabilities, Exemplar, BackendHealth, DeleteResult, LogQuery, LogQueryResult, LogRecord, LogTailBatch, LogTailCursor, LogTailQuery, MetricPoint, MetricQuery, MetricSeries,
  RetentionPolicy, Signal, SpanRecord, TimeRange, TraceSearch, TraceSummary, WriteResult,
} from './telemetry.types';

export class TelemetryUnsupportedError extends Error {
  readonly code = 'UNSUPPORTED';
  constructor(readonly operation: string, readonly backend: string) {
    super(`${backend} does not support ${operation}`);
    this.name = 'TelemetryUnsupportedError';
  }
}

/** The backend answered with an error or could not be reached. Maps to 502; the message carries no backend body. */
export class TelemetryBackendError extends Error {
  readonly code = 'BACKEND';
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'TelemetryBackendError';
  }
}

export interface TelemetryBackend {
  readonly id: string;
  readonly capabilities: BackendCapabilities;

  writeLogs(tenantId: string, records: LogRecord[]): Promise<WriteResult>;
  writeSpans(tenantId: string, spans: SpanRecord[]): Promise<WriteResult>;
  writeMetrics(tenantId: string, points: MetricPoint[]): Promise<WriteResult>;

  queryLogs(tenantId: string, query: LogQuery): Promise<LogQueryResult>;
  /**
   * One poll step of a live tail: the lines that arrived since `cursor` (null = start now), oldest first, capped, with the cursor for the
   * next call and a count of lines it had to skip. Every adapter implements it with `pollLogTail` over its own `queryLogs`, so the
   * behaviour is identical on every backend (a native tail stream, where one exists, may replace the inside later).
   */
  tailLogs(tenantId: string, filter: LogTailQuery, cursor: LogTailCursor | null, opts?: TailOptions): Promise<LogTailBatch>;
  searchTraces(tenantId: string, query: TraceSearch): Promise<TraceSummary[]>;
  /** All spans of one trace, or `null` when this tenant has no such trace. */
  getTrace(tenantId: string, traceId: string): Promise<SpanRecord[] | null>;
  queryMetrics(tenantId: string, query: MetricQuery): Promise<MetricSeries[]>;
  listMetricNames(tenantId: string, range: TimeRange): Promise<string[]>;
  /**
   * The exemplars (sampled traces) behind a metric over the query's range, newest first, at most `MAX_EXEMPLARS_PER_QUERY`, with the labels of
   * their series. Throws `TelemetryUnsupportedError` when `capabilities.exemplars` is false.
   */
  queryExemplars(tenantId: string, query: MetricQuery): Promise<Exemplar[]>;

  /** Root-tenant tooling only (the route enforces it). The text is passed to the backend as written. */
  queryRaw?(tenantId: string, signal: Signal, text: string, range: TimeRange, limit: number): Promise<unknown>;
  /** Per-tenant retention. Throws `TelemetryUnsupportedError` when `capabilities.perTenantRetention` is false. */
  setRetention?(tenantId: string, policy: RetentionPolicy): Promise<void>;
  /** Erase a tenant's signals (all of them when `signals` is omitted). Throws when `capabilities.deletion` is `none`. */
  deleteTenantData?(tenantId: string, signals?: Signal[]): Promise<DeleteResult>;

  health(): Promise<BackendHealth>;
}
