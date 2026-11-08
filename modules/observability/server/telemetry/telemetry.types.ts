/**
 * The vocabulary of the telemetry port: records written, query objects read, results returned. Plain data, no I/O, no
 * backend syntax. Times are epoch milliseconds in queries and results; log and span records also carry the exact
 * nanosecond timestamp as a decimal string (a double cannot hold epoch nanoseconds).
 *
 * Tenancy: a record NEVER carries the tenant as data the caller controls. The tenant is the first argument of every port
 * method; the adapter stamps it (`TENANT_ATTR`) on what it stores.
 */
import { z } from 'zod';

/** The resource / datapoint attribute every adapter writes and every generated query filters on. Never trusted from a client. */
export const TENANT_ATTR = 'nb.tenant_id';
/** The same, as a Prometheus / Loki label name (dots are not legal there). */
export const TENANT_LABEL = 'nb_tenant_id';

export type AttrValue = string | number | boolean;
export type Attributes = Record<string, AttrValue>;

export type SeverityText = 'TRACE' | 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'FATAL';
export const SEVERITIES: readonly SeverityText[] = ['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL'];

export interface LogRecord {
  /** Nanoseconds since epoch, decimal string. */
  timeNs: string;
  severity: SeverityText;
  body: string;
  attributes: Attributes;
  /** Resource attributes (`service.name`, `deployment.environment`, ...). */
  resource: Attributes;
  traceId?: string;
  spanId?: string;
}

export type SpanKind = 'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER';
export type SpanStatus = 'UNSET' | 'OK' | 'ERROR';

export interface SpanEvent {
  timeNs: string;
  name: string;
  attributes: Attributes;
}

export interface SpanRecord {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startNs: string;
  endNs: string;
  status: SpanStatus;
  statusMessage?: string;
  attributes: Attributes;
  resource: Attributes;
  events: SpanEvent[];
}

export type MetricKind = 'gauge' | 'sum' | 'histogram';

export interface HistogramValue {
  count: number;
  sum: number;
  /** Explicit upper bounds; `counts` has one more element (the +Inf bucket). */
  bounds: number[];
  counts: number[];
}

/** One sampled measurement that links a metric point to the trace it was measured in (OpenTelemetry exemplar, Prometheus exemplar). */
export interface Exemplar {
  /** 32 hex characters: the pivot to `getTrace`. An exemplar without a valid trace id is not kept. */
  traceId: string;
  spanId?: string;
  value: number;
  timeMs: number;
  /** The labels of the series the exemplar belongs to (only the `groupBy` ones when the query grouped), so a screen can tell which line it is on. */
  labels: Record<string, string>;
}

/** Most exemplars one data point keeps on ingest, and most one query returns. */
export const MAX_EXEMPLARS_PER_POINT = 5;
export const MAX_EXEMPLARS_PER_QUERY = 50;

export interface MetricPoint {
  name: string;
  kind: MetricKind;
  unit?: string;
  timeMs: number;
  /** gauge / sum value; unused for a histogram. */
  value?: number;
  histogram?: HistogramValue;
  /** `sum` only. */
  monotonic?: boolean;
  /** Sampled traces behind this point (at most `MAX_EXEMPLARS_PER_POINT`); their `labels` are filled by the query, not by ingest. */
  exemplars?: Array<Omit<Exemplar, 'labels'>>;
  attributes: Attributes;
  resource: Attributes;
}

export interface TimeRange {
  fromMs: number;
  toMs: number;
}

export interface WriteResult {
  accepted: number;
  rejected: number;
}

// ── Queries ────────────────────────────────────────────────────────────────────

/** A field name: attribute keys (dots allowed), never a backend label expression. */
export const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
export const METRIC_NAME = /^[A-Za-z_:][A-Za-z0-9_:]{0,127}$/;
export const TRACE_ID_RE = /^[0-9a-f]{32}$/;
export const SPAN_ID_RE = /^[0-9a-f]{16}$/;

const field = z.string().regex(FIELD_NAME, 'invalid field name');
const value = z.string().max(256);

export const FilterOpSchema = z.enum(['eq', 'neq', 'contains', 'prefix']);
export type FilterOp = z.infer<typeof FilterOpSchema>;

export const FieldFilterSchema = z.object({ field, op: FilterOpSchema.default('eq'), value }).strict();
export type FieldFilter = z.infer<typeof FieldFilterSchema>;

export const TimeRangeSchema = z
  .object({ fromMs: z.number().int().nonnegative(), toMs: z.number().int().nonnegative() })
  .strict()
  .refine((r) => r.toMs > r.fromMs, 'range end must be after its start');

export const LogQuerySchema = z
  .object({
    range: TimeRangeSchema,
    limit: z.number().int().min(1).max(1000).default(100),
    direction: z.enum(['newest', 'oldest']).default('newest'),
    service: value.optional(),
    severityMin: z.enum(['TRACE', 'DEBUG', 'INFO', 'WARN', 'ERROR', 'FATAL']).optional(),
    /** Substrings every line must contain (case-sensitive). */
    text: z.array(z.string().min(1).max(256)).max(5).default([]),
    filters: z.array(FieldFilterSchema).max(10).default([]),
    traceId: z.string().regex(TRACE_ID_RE).optional(),
  })
  .strict();
export type LogQuery = z.infer<typeof LogQuerySchema>;

/**
 * What a live tail may filter on: the log query minus everything that is the tail's own business (the window is "from now on", the row
 * count is the tail's per-poll cap, the order is oldest first). Derived from `LogQuerySchema`, so the field names, operators, lengths and
 * the strictness are the REST API's, not a second grammar.
 */
export const LogTailQuerySchema = LogQuerySchema.omit({ range: true, limit: true, direction: true }).strict();
export type LogTailQuery = z.infer<typeof LogTailQuerySchema>;

/** Where a tail stands: the poll window starts a little before `watermarkMs`, and `seen` holds the lines already delivered inside it. */
export interface LogTailCursor {
  watermarkMs: number;
  seen: string[];
  /** Lines older than this were skipped for good (a read that hit its limit); the next poll never goes below it. */
  floorMs: number;
}

export interface LogTailBatch {
  /** New lines, oldest first, at most the per-poll cap. */
  records: LogRecord[];
  cursor: LogTailCursor;
  /** Lines that matched but were not delivered because the batch cap was reached (a lower bound when `truncated`). */
  dropped: number;
  /** The backend had more matching lines than one poll may read, so `dropped` is a lower bound. */
  truncated: boolean;
}

export const TraceSearchSchema = z
  .object({
    range: TimeRangeSchema,
    limit: z.number().int().min(1).max(100).default(20),
    service: value.optional(),
    name: value.optional(),
    minDurationMs: z.number().nonnegative().max(86_400_000).optional(),
    maxDurationMs: z.number().nonnegative().max(86_400_000).optional(),
    status: z.enum(['error', 'ok']).optional(),
    attributes: z.array(z.object({ key: field, value }).strict()).max(10).default([]),
  })
  .strict();
export type TraceSearch = z.infer<typeof TraceSearchSchema>;

/**
 * `p50`..`p99` are quantiles of a HISTOGRAM metric. `q50`..`q95` are quantiles of the raw values of a GAUGE metric over the step (one observation
 * per sample, such as one web vital per page view; PromQL `quantile_over_time`), and `total` is their sum (`sum_over_time`). The two families
 * exist because a per-event gauge is not a histogram and `sum` / `avg` over it answer other questions.
 */
export const METRIC_AGGREGATIONS = ['sum', 'avg', 'min', 'max', 'count', 'rate', 'increase', 'p50', 'p90', 'p95', 'p99', 'q50', 'q75', 'q90', 'q95', 'total'] as const;
export const MetricQuerySchema = z
  .object({
    range: TimeRangeSchema,
    stepSeconds: z.number().int().min(1).max(86_400),
    metric: z.string().regex(METRIC_NAME),
    aggregation: z.enum(METRIC_AGGREGATIONS).default('avg'),
    groupBy: z.array(field).max(4).default([]),
    filters: z.array(z.object({ field, op: z.enum(['eq', 'neq']).default('eq'), value }).strict()).max(10).default([]),
    /** Window of rate / increase / quantile functions. */
    windowSeconds: z.number().int().min(15).max(3600).default(300),
    /** Also return the exemplars (sampled traces) of the series, when the backend keeps them. */
    exemplars: z.boolean().default(false),
  })
  .strict();
export type MetricQuery = z.infer<typeof MetricQuerySchema>;

// ── Results ────────────────────────────────────────────────────────────────────

export interface LogQueryResult {
  records: LogRecord[];
  /** True when more rows matched than `limit` returned. */
  truncated: boolean;
}

export interface TraceSummary {
  traceId: string;
  rootService: string;
  rootName: string;
  startMs: number;
  durationMs: number;
  /** Not every backend can say (Tempo's search does not return them): absent then. */
  spanCount?: number;
  errorCount?: number;
}

export interface MetricSeries {
  metric: string;
  labels: Record<string, string>;
  /** `[timestampMs, value]`, ascending. */
  points: Array<[number, number]>;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

export type Signal = 'logs' | 'traces' | 'metrics';
export const SIGNALS: readonly Signal[] = ['logs', 'traces', 'metrics'];

export interface RetentionPolicy {
  /** Days; per signal, an omitted signal keeps the backend default. */
  days: Partial<Record<Signal, number>>;
}

export interface DeleteResult {
  /** `done`: executed synchronously. `scheduled`: accepted, the backend erases later (Loki's compactor). */
  state: 'done' | 'scheduled';
  /** Records removed, when the adapter can count them. */
  removed?: number;
}

export interface BackendCapabilities {
  signals: Record<Signal, boolean>;
  /** Retention can be set per tenant (not only for the whole backend). */
  perTenantRetention: boolean;
  /** `tenant`: a tenant's signals can be erased (see `deletableSignals`); `none`: not supported. */
  deletion: 'tenant' | 'none';
  /** The signals `deleteTenantData` can erase. Empty when `deletion` is `none`. */
  deletableSignals: Signal[];
  /** `queryRaw` is implemented (root tenant only, at the route). */
  rawQuery: boolean;
  /** Exemplar links from a metric point to a trace. */
  exemplars: boolean;
}

export interface BackendHealth {
  ok: boolean;
  detail?: string;
}
