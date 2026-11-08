/**
 * The tenant-scoped query surface (phase 18.1). Every function takes the tenant id the ROUTE verified (session membership and
 * permission) as its first argument and passes it to the port; there is no code path that reads a tenant from the request body.
 *
 * What a tenant sends is a STRUCTURED query validated by the strict schemas of `telemetry.types.ts`: field names are identifiers,
 * values are opaque strings, there is no place to put LogQL, PromQL or TraceQL. On top of validation sit the caps (time range, points per
 * series, rows, spans, traces): a cap is part of the API contract and an over-cap request is a 400 that names the cap, never a slow query.
 * The root tenant alone may send raw backend syntax (`rawQuery`).
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import type { TelemetryBackend } from './telemetry.backend';
import { CorrelateInputSchema, RawInputSchema, ServiceMapInputSchema } from './telemetry.dto';
import type { QueryCaps, TelemetryLimits } from './telemetry.limits';
import { buildSpanTree, deriveRed, deriveServiceMap, type ServiceMap, type ServiceRed, type SpanTreeNode } from './telemetry.servicemap';
import { traceIdFromRequestId } from './telemetry.propagation';
import { isTenantKey } from './telemetry.tenant';
import {
  LogQuerySchema, MAX_EXEMPLARS_PER_QUERY, MetricQuerySchema, TRACE_ID_RE, TraceSearchSchema, type Exemplar, type LogQuery, type LogRecord, type MetricQuery, type MetricSeries, type Signal, type SpanRecord,
  type TimeRange, type TraceSearch, type TraceSummary,
} from './telemetry.types';
import { nsToMs, serviceOf } from './telemetry.util';

export interface QueryDeps {
  backend: () => TelemetryBackend;
  limits: () => TelemetryLimits;
}

const bad = (message: string, details?: Record<string, unknown>) => new AppError(message, 400, ErrorCode.VALIDATION_ERROR, details ? { details } : undefined);

export function assertRange(range: TimeRange, caps: QueryCaps): void {
  if (range.toMs - range.fromMs > caps.maxRangeMs) throw bad('The time range is longer than this workspace may query', { maxRangeMs: caps.maxRangeMs });
}

/** A client may not aim a filter at the tenant label: it cannot widen anything, but it is a probe, so it is refused outright. */
function assertNoTenantFields(fields: string[]): void {
  if (fields.some(isTenantKey)) throw bad('That field name is reserved');
}

export function checkLogQuery(q: LogQuery, caps: QueryCaps): void {
  assertRange(q.range, caps);
  if (q.limit > caps.maxLogRows) throw bad('The row limit is above what this workspace may query', { maxRows: caps.maxLogRows });
  assertNoTenantFields(q.filters.map((f) => f.field));
}

export function checkTraceSearch(q: TraceSearch, caps: QueryCaps): void {
  assertRange(q.range, caps);
  if (q.limit > caps.maxTraces) throw bad('The trace limit is above what this workspace may query', { maxTraces: caps.maxTraces });
  if (q.minDurationMs !== undefined && q.maxDurationMs !== undefined && q.minDurationMs > q.maxDurationMs) throw bad('minDurationMs is above maxDurationMs');
  assertNoTenantFields(q.attributes.map((a) => a.key));
}

export function checkMetricQuery(q: MetricQuery, caps: QueryCaps): void {
  assertRange(q.range, caps);
  const points = Math.ceil((q.range.toMs - q.range.fromMs) / 1000 / q.stepSeconds);
  if (points > caps.maxPoints) throw bad('The step is too small for this time range', { maxPoints: caps.maxPoints, points });
  assertNoTenantFields([...q.filters.map((f) => f.field), ...q.groupBy]);
}

// ── Logs ───────────────────────────────────────────────────────────────────────

export interface Facet { field: string; values: Array<{ value: string; count: number }> }

/** Top values per field over the rows returned (a page, not the whole result set): `service.name`, `severity` and the commonest attribute keys. */
export function computeFacets(records: LogRecord[], maxFields = 8, maxValues = 8): Facet[] {
  const counts = new Map<string, Map<string, number>>();
  const bump = (field: string, value: string) => {
    let m = counts.get(field);
    if (!m) { m = new Map(); counts.set(field, m); }
    m.set(value, (m.get(value) ?? 0) + 1);
  };
  for (const r of records) {
    bump('service.name', serviceOf(r.resource));
    bump('severity', r.severity);
    for (const [k, v] of Object.entries(r.attributes)) bump(k, String(v));
  }
  const fixed = ['service.name', 'severity'];
  const rest = [...counts.keys()].filter((k) => !fixed.includes(k)).sort((a, b) => (counts.get(b)!.size - counts.get(a)!.size) || a.localeCompare(b));
  return [...fixed, ...rest].filter((field) => counts.has(field)).slice(0, maxFields).map((field) => ({
    field,
    values: [...counts.get(field)!.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, maxValues).map(([value, count]) => ({ value, count })),
  }));
}

export async function queryLogs(deps: QueryDeps, tenantId: string, input: unknown): Promise<{ records: LogRecord[]; truncated: boolean; facets: Facet[] }> {
  const q = LogQuerySchema.parse(input);
  checkLogQuery(q, await deps.limits().queryCaps(tenantId));
  await deps.limits().admitQuery(tenantId);
  const r = await deps.backend().queryLogs(tenantId, q);
  return { records: r.records, truncated: r.truncated, facets: computeFacets(r.records) };
}

// ── Traces ─────────────────────────────────────────────────────────────────────

export async function searchTraces(deps: QueryDeps, tenantId: string, input: unknown): Promise<{ traces: TraceSummary[] }> {
  const q = TraceSearchSchema.parse(input);
  checkTraceSearch(q, await deps.limits().queryCaps(tenantId));
  await deps.limits().admitQuery(tenantId);
  return { traces: await deps.backend().searchTraces(tenantId, q) };
}

export interface TraceView {
  traceId: string;
  summary: { spanCount: number; errorCount: number; durationMs: number; services: string[]; truncated: boolean };
  tree: SpanTreeNode[];
}

export async function getTrace(deps: QueryDeps, tenantId: string, traceId: string): Promise<TraceView> {
  if (!TRACE_ID_RE.test(traceId)) throw bad('Invalid trace id');
  const caps = await deps.limits().queryCaps(tenantId);
  await deps.limits().admitQuery(tenantId);
  const all = await deps.backend().getTrace(tenantId, traceId);
  // The same answer for "no such trace" and "a trace of another tenant": the port already returns null for both.
  if (!all) throw new AppError('Trace not found', 404, ErrorCode.NOT_FOUND);
  const spans = all.slice(0, caps.maxSpans);
  return { traceId, summary: summarizeSpans(spans, all.length > spans.length), tree: buildSpanTree(spans) };
}

function summarizeSpans(spans: SpanRecord[], truncated: boolean): TraceView['summary'] {
  const start = Math.min(...spans.map((s) => nsToMs(s.startNs)));
  const end = Math.max(...spans.map((s) => nsToMs(s.endNs)));
  return {
    spanCount: spans.length, errorCount: spans.filter((s) => s.status === 'ERROR').length, durationMs: Math.max(0, Math.round((end - start) * 1000) / 1000),
    services: [...new Set(spans.map((s) => serviceOf(s.resource)))].sort(), truncated,
  };
}

// ── Metrics ────────────────────────────────────────────────────────────────────

export interface MetricsResult {
  series: MetricSeries[];
  /** Present only when asked for (`exemplars: true`). `supported: false` says the backend keeps none, which is not the same as "none in this range". */
  exemplars?: { supported: boolean; items: Exemplar[] };
}

export async function queryMetrics(deps: QueryDeps, tenantId: string, input: unknown): Promise<MetricsResult> {
  const q = MetricQuerySchema.parse(input);
  checkMetricQuery(q, await deps.limits().queryCaps(tenantId));
  await deps.limits().admitQuery(tenantId);
  const backend = deps.backend();
  const series = await backend.queryMetrics(tenantId, q);
  if (!q.exemplars) return { series };
  if (!backend.capabilities.exemplars) return { series, exemplars: { supported: false, items: [] } };
  // Exemplars are an addition to the chart: a failure to read them must not take the chart away.
  const items = await backend.queryExemplars(tenantId, q).catch(() => [] as Exemplar[]);
  return { series, exemplars: { supported: true, items: items.slice(0, MAX_EXEMPLARS_PER_QUERY) } };
}

export async function listMetricNames(deps: QueryDeps, tenantId: string, range: unknown): Promise<{ names: string[] }> {
  const r = LogQuerySchema.shape.range.parse(range);
  assertRange(r, await deps.limits().queryCaps(tenantId));
  await deps.limits().admitQuery(tenantId);
  return { names: (await deps.backend().listMetricNames(tenantId, r)).slice(0, 5000) };
}

// ── Service map and RED ────────────────────────────────────────────────────────

/** Loads the spans of a sample of recent traces, bounded by the trace limit and the span cap (3 backend calls in flight at most). */
export async function sampleSpans(deps: QueryDeps, tenantId: string, range: TimeRange, traceLimit: number, caps: QueryCaps): Promise<{ spans: SpanRecord[]; traces: number; truncated: boolean }> {
  const found = await deps.backend().searchTraces(tenantId, TraceSearchSchema.parse({ range, limit: Math.min(traceLimit, caps.maxTraces) }));
  const spans: SpanRecord[] = [];
  let truncated = false;
  let next = 0;
  const worker = async () => {
    while (next < found.length && !truncated) {
      const t = found[next++]!;
      const s = await deps.backend().getTrace(tenantId, t.traceId);
      if (!s) continue;
      if (spans.length + s.length > caps.maxSpans) { truncated = true; spans.push(...s.slice(0, Math.max(0, caps.maxSpans - spans.length))); break; }
      spans.push(...s);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { spans, traces: found.length, truncated };
}

export async function serviceMap(deps: QueryDeps, tenantId: string, input: unknown): Promise<{ map: ServiceMap; red: ServiceRed[]; sample: { traces: number; spans: number; truncated: boolean } }> {
  const q = ServiceMapInputSchema.parse(input);
  const caps = await deps.limits().queryCaps(tenantId);
  assertRange(q.range, caps);
  await deps.limits().admitQuery(tenantId);
  const { spans, traces, truncated } = await sampleSpans(deps, tenantId, q.range, q.traceLimit, caps);
  return { map: deriveServiceMap(spans), red: deriveRed(spans, q.range.toMs - q.range.fromMs), sample: { traces, spans: spans.length, truncated } };
}

// ── Correlation ────────────────────────────────────────────────────────────────

export interface Correlation {
  window: TimeRange;
  trace: TraceView | null;
  traces: TraceSummary[];
  logs: LogRecord[];
  metrics: MetricSeries[];
  /** The ids the lookup resolved, so the page can show how the match was made. */
  resolved: { traceId?: string; requestId?: string };
  /** Present when labels were sent: the ones applied, and whether any log carried them (`false` = the logs shown are the window's warnings and errors instead). */
  labels?: { applied: Record<string, string>; matched: boolean };
}

/** Label names that mean "this service" in an alert, a Prometheus rule or an OpenTelemetry resource. */
const SERVICE_LABELS = new Set(['service.name', 'service_name', 'service', 'job']);

/** The log query parts a set of labels stands for: the service (one of the aliases) and equality filters for the rest. */
export function labelsToLogFilters(labels: Record<string, string>): { service?: string; filters: Array<{ field: string; op: 'eq'; value: string }> } {
  const filters: Array<{ field: string; op: 'eq'; value: string }> = [];
  let service: string | undefined;
  for (const [field, value] of Object.entries(labels)) {
    if (!value) continue;
    if (SERVICE_LABELS.has(field)) { service ??= value; continue; }
    filters.push({ field, op: 'eq', value });
  }
  return { ...(service ? { service } : {}), filters };
}

const INTERESTING_METRIC = /(duration|latency|request|error|fail|count|queue)/i;

/**
 * Given a trace id, a request id or a moment, the related logs, traces and metric series. A request id maps to its trace id (the same bits
 * for an NB-minted id) and is also matched against the `request.id` / `requestId` log attributes, so a log line that only knows the request
 * id is found as well. Metrics: up to three series, chosen among the tenant's metric names by an "interesting" name pattern, filtered to the
 * services the trace touched.
 */
export async function correlate(deps: QueryDeps, tenantId: string, input: unknown): Promise<Correlation> {
  const q = CorrelateInputSchema.parse(input);
  const caps = await deps.limits().queryCaps(tenantId);
  await deps.limits().admitQuery(tenantId);
  const backend = deps.backend();
  const now = Date.now();
  let traceId = q.traceId ?? (q.requestId ? traceIdFromRequestId(q.requestId) : undefined);

  let trace: TraceView | null = null;
  let spans: SpanRecord[] = [];
  if (traceId) {
    const found = await backend.getTrace(tenantId, traceId).catch(() => null);
    if (found) {
      spans = found.slice(0, caps.maxSpans);
      trace = { traceId, summary: summarizeSpans(spans, found.length > spans.length), tree: buildSpanTree(spans) };
    } else if (!q.traceId) traceId = undefined; // a derived id with no trace behind it is only a hint
  }

  const labels = q.labels ?? {};
  assertNoTenantFields(Object.keys(labels));
  if (q.window && q.window.toMs - q.window.fromMs > caps.maxRangeMs) throw bad('The time range is longer than this workspace may query', { maxRangeMs: caps.maxRangeMs });
  const labelParts = labelsToLogFilters(labels);
  const half = Math.min(q.windowMs, caps.maxRangeMs / 2);
  // With a trace the window is the trace's own. With a time it is that moment +- the window. With only a request id (no idea when) it is the
  // last day (or the cap), because a request id on a support ticket is usually recent but is not "now".
  const window: TimeRange = trace
    ? { fromMs: Math.floor(Math.min(...spans.map((s) => nsToMs(s.startNs))) - 1000), toMs: Math.ceil(Math.max(...spans.map((s) => nsToMs(s.endNs))) + 1000) }
    : q.window
      ? { fromMs: q.window.fromMs, toMs: q.window.toMs }
    : q.atMs !== undefined
      ? { fromMs: Math.max(0, Math.floor(q.atMs - half)), toMs: Math.ceil(q.atMs + half) }
      : q.requestId
        ? { fromMs: Math.max(0, now - Math.min(86_400_000, caps.maxRangeMs)), toMs: now }
        : { fromMs: Math.max(0, Math.floor(now - half)), toMs: Math.ceil(now + half) };
  if (window.toMs - window.fromMs > caps.maxRangeMs) window.fromMs = window.toMs - caps.maxRangeMs;
  const logRange = trace ? { fromMs: window.fromMs - q.windowMs, toMs: window.toMs + q.windowMs } : window;

  const logLimit = Math.min(200, caps.maxLogRows);
  const logQueries: Array<Promise<LogRecord[]>> = [];
  const lq = (extra: object) => backend.queryLogs(tenantId, LogQuerySchema.parse({ range: logRange, limit: logLimit, ...extra })).then((r) => r.records).catch(() => []);
  if (traceId) logQueries.push(lq({ traceId }));
  if (q.requestId) {
    logQueries.push(lq({ filters: [{ field: 'request.id', op: 'eq', value: q.requestId }] }));
    logQueries.push(lq({ filters: [{ field: 'requestId', op: 'eq', value: q.requestId }] }));
  }
  const windowOnly = !traceId && !q.requestId;
  const hasLabels = Object.keys(labels).length > 0 && windowOnly;
  if (windowOnly) logQueries.push(lq({ severityMin: 'WARN', ...(hasLabels ? labelParts : {}) }));
  const seen = new Set<string>();
  const dedupe = (rows: LogRecord[][]) => rows.flat().filter((r) => { const k = `${r.timeNs}|${r.body}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => (BigInt(a.timeNs) < BigInt(b.timeNs) ? -1 : 1)).slice(0, logLimit);
  let logs = dedupe(await Promise.all(logQueries));
  // Labels that no log carries must not leave the screen empty and unexplained: fall back to the window's warnings and errors, and say so.
  let labelsMatched = true;
  if (hasLabels && logs.length === 0) {
    labelsMatched = false;
    seen.clear();
    logs = dedupe([await lq({ severityMin: 'WARN' })]);
  }

  // A request id found on a log line leads to a trace even when the derived id matched nothing.
  if (!trace && q.requestId) {
    const linked = logs.find((l) => l.traceId)?.traceId;
    if (linked) {
      const found = await backend.getTrace(tenantId, linked).catch(() => null);
      if (found) { spans = found.slice(0, caps.maxSpans); traceId = linked; trace = { traceId: linked, summary: summarizeSpans(spans, found.length > spans.length), tree: buildSpanTree(spans) }; }
    }
  }

  const traces = trace ? [] : await backend.searchTraces(tenantId, TraceSearchSchema.parse({ range: window, limit: Math.min(10, caps.maxTraces), status: 'error', ...(hasLabels && labelsMatched && labelParts.service ? { service: labelParts.service } : {}) })).catch(() => []);

  const services = trace ? trace.summary.services : hasLabels && labelsMatched && labelParts.service ? [labelParts.service] : [...new Set(traces.map((t) => t.rootService))].slice(0, 3);
  const metrics: MetricSeries[] = [];
  try {
    const names = (await backend.listMetricNames(tenantId, window)).filter((n) => INTERESTING_METRIC.test(n)).slice(0, 3);
    const step = Math.max(15, Math.ceil((window.toMs - window.fromMs) / 1000 / Math.min(60, caps.maxPoints)));
    for (const metric of names) {
      const series = await backend.queryMetrics(tenantId, MetricQuerySchema.parse({
        range: window, stepSeconds: step, metric, aggregation: 'avg', groupBy: [], filters: services.length === 1 ? [{ field: 'service.name', op: 'eq', value: services[0]! }] : [],
      }));
      metrics.push(...series.slice(0, 3));
    }
  } catch { /* metrics are best effort: the logs and traces are the answer */ }

  return {
    window, trace, traces, logs, metrics, resolved: { ...(traceId ? { traceId } : {}), ...(q.requestId ? { requestId: q.requestId } : {}) },
    ...(hasLabels ? { labels: { applied: labels, matched: labelsMatched } } : {}),
  };
}

// ── Raw (root tenant only) ─────────────────────────────────────────────────────

export async function queryRaw(deps: QueryDeps, tenantId: string, input: unknown): Promise<{ result: unknown }> {
  // The route checks too; this is the second lock, so a new caller of the service cannot forget it. 404, not 403: the mode does not exist elsewhere.
  if (!isRootTenant(tenantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND);
  const q = RawInputSchema.parse(input);
  const caps = await deps.limits().queryCaps(tenantId);
  assertRange(q.range, caps);
  const backend = deps.backend();
  if (!backend.queryRaw || !backend.capabilities.rawQuery) throw new AppError('The configured backend has no raw query mode', 501, ErrorCode.FEATURE_NOT_AVAILABLE);
  await deps.limits().admitQuery(tenantId);
  return { result: await backend.queryRaw(tenantId, q.signal as Signal, q.text, q.range, Math.min(q.limit, caps.maxLogRows)) };
}

