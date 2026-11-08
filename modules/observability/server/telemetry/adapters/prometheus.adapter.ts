/**
 * Prometheus-compatible metrics adapter (Prometheus 3 with the OTLP receiver, Mimir, VictoriaMetrics' Prometheus API), exercised against a live Prometheus 3.15.0
 * (`scripts/telemetry-live.mjs`, ADR-0009).
 *
 *  - Write: OTLP protobuf to `POST /api/v1/otlp/v1/metrics` (needs `--web.enable-otlp-receiver`; verified on 3.15.0 that the receiver takes
 *    OTLP JSON as well, protobuf is what is sent). The tenant is a DATAPOINT attribute `nb_tenant_id`, so it is a label with no
 *    `promote_resource_attributes` configuration.
 *  - Read: `GET /api/v1/query_range` with PromQL generated from the structured query; every selector starts with the tenant matcher.
 *  - Prometheus is single-tenant: no per-tenant retention. `deletion` is available only when the operator enabled the admin API
 *    (`--web.enable-admin-api`) and says so with `enableAdminApi`; it then deletes the series carrying the tenant label.
 *  - Exemplars: written with the data points (OTLP exemplars) and read with `GET /api/v1/query_exemplars`. Needs
 *    `--enable-feature=exemplar-storage`; verified against Prometheus 3.15.0 (scripts/telemetry-exemplars-live.mjs).
 *  - With `tenantHeader` set (Mimir: `X-Scope-OrgID`) the tenant is also sent as that header.
 */
import type { TelemetryBackend } from '../telemetry.backend';
import { TelemetryBackendError, TelemetryUnsupportedError } from '../telemetry.backend';
import {
  MAX_EXEMPLARS_PER_QUERY, TENANT_LABEL, type BackendCapabilities, type DeleteResult, type Exemplar, type LogQuery, type LogQueryResult, type MetricPoint, type MetricQuery,
  type MetricSeries, type Signal, type SpanRecord, type TimeRange, type TraceSearch, type TraceSummary, type WriteResult,
} from '../telemetry.types';
import { normalizeId, stripTenant } from '../telemetry.util';
import { encodeMetricsProto } from '../otlp.protobuf';
import { httpRequest, parseJson, type HttpTarget } from './http';
import { buildExemplarSelector, buildPromQL, tenantSelector } from './query.promql';

export interface PrometheusOptions {
  /** Send the tenant as this header too (Mimir uses `X-Scope-OrgID`). Off for plain Prometheus. */
  tenantHeader?: string;
  /** The operator started Prometheus with `--web.enable-admin-api`, so series deletion is possible. */
  enableAdminApi?: boolean;
}

export class PrometheusMetricsBackend implements TelemetryBackend {
  readonly id = 'prometheus';
  readonly capabilities: BackendCapabilities;

  constructor(private readonly target: HttpTarget, private readonly opts: PrometheusOptions = {}) {
    this.capabilities = {
      signals: { logs: false, traces: false, metrics: true },
      perTenantRetention: false,
      deletion: opts.enableAdminApi ? 'tenant' : 'none',
      deletableSignals: opts.enableAdminApi ? ['metrics'] : [],
      rawQuery: true,
      exemplars: true,
    };
  }

  private headers(tenantId: string, extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.opts.tenantHeader ? { [this.opts.tenantHeader]: tenantId } : {}), ...extra };
  }

  async writeMetrics(tenantId: string, points: MetricPoint[]): Promise<WriteResult> {
    if (!points.length) return { accepted: 0, rejected: 0 };
    // The tenant label is stamped here, after anything the client sent was removed.
    const stamped = points.map((p) => ({ ...p, attributes: { ...stripTenant(p.attributes), [TENANT_LABEL]: tenantId }, resource: stripTenant(p.resource) }));
    await httpRequest(this.target, this.id, 'POST', '/api/v1/otlp/v1/metrics', {
      headers: this.headers(tenantId, { 'Content-Type': 'application/x-protobuf' }), body: encodeMetricsProto(stamped),
    });
    return { accepted: points.length, rejected: 0 };
  }

  async queryMetrics(tenantId: string, q: MetricQuery): Promise<MetricSeries[]> {
    const { text } = await httpRequest(this.target, this.id, 'GET', '/api/v1/query_range', {
      headers: this.headers(tenantId),
      query: { query: buildPromQL(tenantId, q), start: String(q.range.fromMs / 1000), end: String(q.range.toMs / 1000), step: String(q.stepSeconds) },
    });
    return parseMatrix(this.id, parseJson(this.id, text), q.metric);
  }

  /** `GET /api/v1/query_exemplars` (needs `--enable-feature=exemplar-storage`; a Prometheus without it answers with no exemplars). */
  async queryExemplars(tenantId: string, q: MetricQuery): Promise<Exemplar[]> {
    const { text } = await httpRequest(this.target, this.id, 'GET', '/api/v1/query_exemplars', {
      headers: this.headers(tenantId),
      query: { query: buildExemplarSelector(tenantId, q), start: String(q.range.fromMs / 1000), end: String(q.range.toMs / 1000) },
    });
    return parseExemplars(this.id, parseJson(this.id, text), q.groupBy);
  }

  async listMetricNames(tenantId: string, range: TimeRange): Promise<string[]> {
    const { text } = await httpRequest(this.target, this.id, 'GET', '/api/v1/label/__name__/values', {
      headers: this.headers(tenantId), query: { 'match[]': tenantSelector(tenantId), start: String(range.fromMs / 1000), end: String(range.toMs / 1000) },
    });
    const data = (parseJson(this.id, text) as { data?: unknown }).data;
    if (!Array.isArray(data)) throw new TelemetryBackendError(`${this.id} returned an unexpected response`);
    return data.filter((x): x is string => typeof x === 'string').sort();
  }

  async queryRaw(tenantId: string, signal: Signal, text: string, range: TimeRange, _limit?: number): Promise<unknown> {
    if (signal !== 'metrics') throw new TelemetryUnsupportedError(`raw ${signal} query`, this.id);
    const step = Math.max(15, Math.ceil((range.toMs - range.fromMs) / 1000 / 500));
    const res = await httpRequest(this.target, this.id, 'GET', '/api/v1/query_range', {
      headers: this.headers(tenantId), query: { query: text, start: String(range.fromMs / 1000), end: String(range.toMs / 1000), step: String(step) },
    });
    return parseJson(this.id, res.text);
  }

  async deleteTenantData(tenantId: string, signals?: Signal[]): Promise<DeleteResult> {
    if (!this.opts.enableAdminApi || (signals && signals.some((s) => s !== 'metrics'))) throw new TelemetryUnsupportedError('deleteTenantData', this.id);
    await httpRequest(this.target, this.id, 'POST', '/api/v1/admin/tsdb/delete_series', { headers: this.headers(tenantId), query: { 'match[]': tenantSelector(tenantId) } });
    // Series are tombstoned: data queries stop returning them at once (verified against Prometheus 3.15). The space is reclaimed by the next
    // compaction; clean_tombstones rewrites persisted blocks now (best effort: head data is not touched by it). Metric and label NAMES stay
    // listed by the label-values and series APIs until the head is compacted: those two ignore tombstones.
    await httpRequest(this.target, this.id, 'POST', '/api/v1/admin/tsdb/clean_tombstones', { headers: this.headers(tenantId) }).catch(() => undefined);
    return { state: 'scheduled' };
  }

  async health() {
    try {
      await httpRequest(this.target, this.id, 'GET', '/-/ready');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
    }
  }

  async writeLogs(): Promise<WriteResult> { throw new TelemetryUnsupportedError('logs', this.id); }
  async writeSpans(): Promise<WriteResult> { throw new TelemetryUnsupportedError('traces', this.id); }
  async queryLogs(_t: string, _q: LogQuery): Promise<LogQueryResult> { throw new TelemetryUnsupportedError('logs', this.id); }
  async tailLogs(): Promise<never> { throw new TelemetryUnsupportedError('logs', this.id); }
  async searchTraces(_t: string, _q: TraceSearch): Promise<TraceSummary[]> { throw new TelemetryUnsupportedError('traces', this.id); }
  async getTrace(): Promise<SpanRecord[] | null> { throw new TelemetryUnsupportedError('traces', this.id); }
}

function parseExemplars(id: string, body: unknown, groupBy: string[]): Exemplar[] {
  const data = (body as { data?: Array<{ seriesLabels?: Record<string, string>; exemplars?: Array<{ labels?: Record<string, string>; value?: string; timestamp?: number }> }> })?.data;
  if (!Array.isArray(data)) throw new TelemetryBackendError(`${id} returned an unexpected response`);
  const out: Exemplar[] = [];
  for (const series of data) {
    const sl = series.seriesLabels ?? {};
    const labels = Object.fromEntries(groupBy.filter((g) => sl[g.replace(/\./g, '_')] !== undefined).map((g) => [g, sl[g.replace(/\./g, '_')]!]));
    for (const e of series.exemplars ?? []) {
      const l = e.labels ?? {};
      const traceId = normalizeId(l.trace_id ?? l.traceID ?? l.traceId, 32);
      const value = Number(e.value);
      if (!traceId || !Number.isFinite(value) || typeof e.timestamp !== 'number') continue;
      const spanId = normalizeId(l.span_id ?? l.spanID ?? l.spanId, 16);
      out.push({ traceId, value, timeMs: Math.round(e.timestamp * 1000), labels, ...(spanId ? { spanId } : {}) });
    }
  }
  return out.sort((a, b) => b.timeMs - a.timeMs).slice(0, MAX_EXEMPLARS_PER_QUERY);
}

function parseMatrix(id: string, body: unknown, metric: string): MetricSeries[] {
  const data = (body as { data?: { resultType?: string; result?: Array<{ metric?: Record<string, string>; values?: Array<[number, string]> }> } })?.data;
  if (!data || data.resultType !== 'matrix' || !Array.isArray(data.result)) throw new TelemetryBackendError(`${id} returned an unexpected response`);
  return data.result.map((s) => {
    const labels = Object.fromEntries(Object.entries(s.metric ?? {}).filter(([k]) => k !== '__name__' && k !== TENANT_LABEL));
    const points: Array<[number, number]> = [];
    for (const [t, v] of s.values ?? []) {
      const n = Number(v);
      if (Number.isFinite(n)) points.push([Math.round(t * 1000), n]);
    }
    return { metric, labels, points };
  }).filter((s) => s.points.length > 0);
}
