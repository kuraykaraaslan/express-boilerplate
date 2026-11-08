/**
 * Tempo trace adapter, written against the documented HTTP API (OTLP/HTTP ingest, `GET /api/traces/<id>`, TraceQL
 * `GET /api/search`) and exercised only against recorded-fixture fakes, never a live server (ADR-0009).
 *
 *  - Tenancy: `X-Scope-OrgID: <tenant>` on every request AND the resource attribute `nb.tenant_id` stamped on every span and
 *    required by every generated TraceQL query.
 *  - Ingest goes to Tempo's OTLP/HTTP receiver (`ingestUrl`, default port 4318, `/v1/traces`) as OTLP JSON; whether that receiver
 *    accepts JSON as well as protobuf is UNVERIFIED. Queries go to the query-frontend (`target.baseUrl`, port 3200).
 *  - Tempo's search hit carries `serviceStats` (span and error counts per service over the whole trace); they are summed into `spanCount` / `errorCount`.
 *  - Retention is Tempo's per-tenant overrides, not an API, and Tempo has no delete API: both are unsupported.
 */
import type { TelemetryBackend } from '../telemetry.backend';
import { TelemetryBackendError, TelemetryUnsupportedError } from '../telemetry.backend';
import {
  TENANT_ATTR, type BackendCapabilities, type LogQuery, type LogQueryResult, type MetricQuery, type MetricSeries, type Signal,
  type SpanRecord, type TimeRange, type TraceSearch, type TraceSummary, type WriteResult, TRACE_ID_RE,
} from '../telemetry.types';
import { nsToMs, stripTenant } from '../telemetry.util';
import { decodeTraces, encodeTracesJson } from '../otlp.codec';
import { httpRequest, parseJson, type HttpTarget } from './http';
import { buildTraceQL } from './query.traceql';

export interface TempoOptions {
  /** OTLP/HTTP receiver base, for example `http://tempo:4318`. Defaults to the query base with port 4318. */
  ingestUrl?: string;
}

/** `serviceStats` of a Tempo search hit: `{ <service>: { spanCount, errorCount? } }` over the WHOLE trace (verified against Tempo 2.10.8). */
function countsOf(stats: unknown): { spanCount?: number; errorCount?: number } {
  if (!stats || typeof stats !== 'object') return {};
  let spans = 0;
  let errors = 0;
  for (const v of Object.values(stats as Record<string, { spanCount?: unknown; errorCount?: unknown }>)) {
    spans += Number(v?.spanCount ?? 0) || 0;
    errors += Number(v?.errorCount ?? 0) || 0;
  }
  return spans > 0 ? { spanCount: spans, errorCount: errors } : {};
}

export class TempoTraceBackend implements TelemetryBackend {
  readonly id = 'tempo';
  readonly capabilities: BackendCapabilities = {
    signals: { logs: false, traces: true, metrics: false },
    perTenantRetention: false,
    deletion: 'none',
    deletableSignals: [],
    rawQuery: true,
    exemplars: false,
  };

  constructor(private readonly target: HttpTarget, private readonly opts: TempoOptions = {}) {}

  private headers(tenantId: string, extra: Record<string, string> = {}): Record<string, string> {
    return { 'X-Scope-OrgID': tenantId, ...extra };
  }

  private ingestTarget(): HttpTarget {
    if (this.opts.ingestUrl) return { ...this.target, baseUrl: this.opts.ingestUrl };
    const u = new URL(this.target.baseUrl);
    u.port = '4318';
    return { ...this.target, baseUrl: u.origin };
  }

  async writeSpans(tenantId: string, spans: SpanRecord[]): Promise<WriteResult> {
    if (!spans.length) return { accepted: 0, rejected: 0 };
    const stamped = spans.map((s) => ({ ...s, attributes: stripTenant(s.attributes), resource: { ...stripTenant(s.resource), [TENANT_ATTR]: tenantId } }));
    await httpRequest(this.ingestTarget(), this.id, 'POST', '/v1/traces', {
      headers: this.headers(tenantId, { 'Content-Type': 'application/json' }), body: JSON.stringify(encodeTracesJson(stamped)),
    });
    return { accepted: spans.length, rejected: 0 };
  }

  async searchTraces(tenantId: string, q: TraceSearch): Promise<TraceSummary[]> {
    const { text } = await httpRequest(this.target, this.id, 'GET', '/api/search', {
      headers: this.headers(tenantId),
      query: { q: buildTraceQL(tenantId, q), start: String(Math.floor(q.range.fromMs / 1000)), end: String(Math.ceil(q.range.toMs / 1000)), limit: String(q.limit), spss: '1' },
    });
    const traces = (parseJson(this.id, text) as { traces?: unknown }).traces ?? [];
    if (!Array.isArray(traces)) throw new TelemetryBackendError(`${this.id} returned an unexpected response`);
    const out: TraceSummary[] = [];
    for (const t of traces as Array<Record<string, unknown>>) {
      if (typeof t.traceID !== 'string' || !TRACE_ID_RE.test(t.traceID.toLowerCase().padStart(32, '0'))) continue;
      out.push({
        traceId: t.traceID.toLowerCase().padStart(32, '0'), rootService: typeof t.rootServiceName === 'string' ? t.rootServiceName : 'unknown_service',
        rootName: typeof t.rootTraceName === 'string' ? t.rootTraceName : '', startMs: nsToMs(String(t.startTimeUnixNano ?? '0')),
        durationMs: Number(t.durationMs ?? 0),
        ...countsOf(t.serviceStats),
      });
    }
    return out.sort((a, b) => b.startMs - a.startMs);
  }

  async getTrace(tenantId: string, traceId: string): Promise<SpanRecord[] | null> {
    if (!TRACE_ID_RE.test(traceId)) return null;
    const { status, text } = await httpRequest(this.target, this.id, 'GET', `/api/traces/${traceId}`, { headers: this.headers(tenantId), okStatuses: [404] });
    if (status === 404) return null;
    const body = parseJson(this.id, text) as Record<string, unknown>;
    // v1 answers `{ batches }`, v2 `{ trace: { resourceSpans } }`; OTLP JSON itself is `{ resourceSpans }`.
    const doc = (body.trace as Record<string, unknown> | undefined) ?? body;
    const root = { resourceSpans: doc.resourceSpans ?? doc.batches ?? [] };
    const spans = decodeTraces(root).items
      // Defence in depth: the header already scopes the read, a span stamped for another tenant is never returned.
      .filter((s) => s.resource[TENANT_ATTR] === undefined || s.resource[TENANT_ATTR] === tenantId);
    return spans.length ? spans : null;
  }

  async queryRaw(tenantId: string, signal: Signal, text: string, range: TimeRange, limit: number): Promise<unknown> {
    if (signal !== 'traces') throw new TelemetryUnsupportedError(`raw ${signal} query`, this.id);
    const res = await httpRequest(this.target, this.id, 'GET', '/api/search', {
      headers: this.headers(tenantId), query: { q: text, start: String(Math.floor(range.fromMs / 1000)), end: String(Math.ceil(range.toMs / 1000)), limit: String(limit) },
    });
    return parseJson(this.id, res.text);
  }

  async health() {
    try {
      await httpRequest(this.target, this.id, 'GET', '/ready');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
    }
  }

  async writeLogs(): Promise<WriteResult> { throw new TelemetryUnsupportedError('logs', this.id); }
  async writeMetrics(): Promise<WriteResult> { throw new TelemetryUnsupportedError('metrics', this.id); }
  async queryLogs(_t: string, _q: LogQuery): Promise<LogQueryResult> { throw new TelemetryUnsupportedError('logs', this.id); }
  async tailLogs(): Promise<never> { throw new TelemetryUnsupportedError('logs', this.id); }
  async queryMetrics(_t: string, _q: MetricQuery): Promise<MetricSeries[]> { throw new TelemetryUnsupportedError('metrics', this.id); }
  async listMetricNames(): Promise<string[]> { throw new TelemetryUnsupportedError('metrics', this.id); }
  async queryExemplars(): Promise<never> { throw new TelemetryUnsupportedError('metrics', this.id); }
}
