/**
 * Loki log adapter, written against the documented HTTP API (push JSON, `query_range`, delete) and exercised only against
 * recorded-fixture fakes, never a live server (ADR-0009).
 *
 *  - Tenancy: `X-Scope-OrgID: <tenant>` on every request AND the stream label `nb_tenant_id` in every push and every selector.
 *  - Stream labels are kept few (`nb_tenant_id`, `service_name`, `severity`); everything else is structured metadata (Loki 3,
 *    TSDB schema v13), so cardinality never explodes. A Loki without structured metadata rejects the push; that is reported as
 *    a backend error, not silently dropped.
 *  - Attribute keys come back with `.` turned into `_` (LogQL labels cannot contain dots).
 *  - Retention is per tenant in Loki's runtime overrides, not an API: `perTenantRetention` is false. Deletion uses the compactor's
 *    delete API (`state: 'scheduled'`; requires `compactor.retention_enabled` and a delete store).
 */
import type { TelemetryBackend } from '../telemetry.backend';
import { TelemetryBackendError, TelemetryUnsupportedError } from '../telemetry.backend';
import {
  TENANT_ATTR, TENANT_LABEL, type BackendCapabilities, type DeleteResult, type LogQuery, type LogQueryResult, type LogRecord, type LogTailBatch, type LogTailCursor, type LogTailQuery, type MetricPoint, type MetricQuery,
  type MetricSeries, type Signal, type SpanRecord, type TimeRange, type TraceSearch, type TraceSummary, type WriteResult, SEVERITIES, type SeverityText,
} from '../telemetry.types';
import { pollLogTail, type TailOptions } from '../telemetry.tail';
import { msToNs, serviceOf, stripTenant } from '../telemetry.util';
import { httpRequest, parseJson, type HttpTarget } from './http';
import { buildLogQL, labelName, quote } from './query.logql';

const SCRUBBED_LABELS = new Set([TENANT_LABEL, 'service_name', 'severity', 'trace_id', 'span_id', 'detected_level', 'level', 'service']);

export class LokiLogBackend implements TelemetryBackend {
  readonly id = 'loki';
  readonly capabilities: BackendCapabilities = {
    signals: { logs: true, traces: false, metrics: false },
    perTenantRetention: false,
    deletion: 'tenant',
    deletableSignals: ['logs'],
    rawQuery: true,
    exemplars: false,
  };

  constructor(private readonly target: HttpTarget) {}

  private headers(tenantId: string, extra: Record<string, string> = {}): Record<string, string> {
    return { 'X-Scope-OrgID': tenantId, ...extra };
  }

  async writeLogs(tenantId: string, records: LogRecord[]): Promise<WriteResult> {
    const streams = new Map<string, { stream: Record<string, string>; values: Array<[string, string, Record<string, string>]> }>();
    for (const r of records) {
      const stream = { [TENANT_LABEL]: tenantId, service_name: serviceOf(r.resource), severity: r.severity };
      const key = JSON.stringify(stream);
      const meta: Record<string, string> = {};
      for (const [k, v] of Object.entries(stripTenant(r.attributes))) {
        let name: string;
        try { name = labelName(k); } catch { continue; }
        if (!SCRUBBED_LABELS.has(name)) meta[name] = String(v);
      }
      if (r.traceId) meta.trace_id = r.traceId;
      if (r.spanId) meta.span_id = r.spanId;
      const entry: [string, string, Record<string, string>] = [r.timeNs, r.body, meta];
      const s = streams.get(key);
      if (s) s.values.push(entry); else streams.set(key, { stream, values: [entry] });
    }
    if (!streams.size) return { accepted: 0, rejected: 0 };
    await httpRequest(this.target, this.id, 'POST', '/loki/api/v1/push', {
      headers: this.headers(tenantId, { 'Content-Type': 'application/json' }), body: JSON.stringify({ streams: [...streams.values()] }),
    });
    return { accepted: records.length, rejected: 0 };
  }

  async queryLogs(tenantId: string, q: LogQuery): Promise<LogQueryResult> {
    const { text } = await httpRequest(this.target, this.id, 'GET', '/loki/api/v1/query_range', {
      headers: this.headers(tenantId),
      query: {
        query: buildLogQL(tenantId, q), start: msToNs(q.range.fromMs), end: msToNs(q.range.toMs), limit: String(q.limit + 1),
        direction: q.direction === 'newest' ? 'backward' : 'forward',
      },
    });
    const records = parseStreams(this.id, parseJson(this.id, text));
    records.sort((a, b) => (a.timeNs === b.timeNs ? 0 : BigInt(a.timeNs) < BigInt(b.timeNs) ? -1 : 1));
    if (q.direction === 'newest') records.reverse();
    return { records: records.slice(0, q.limit), truncated: records.length > q.limit };
  }

  /** Polls `query_range` (see `telemetry.tail.ts`): the same answer as Loki's `/tail` stream without holding a WebSocket open per tenant. */
  tailLogs(tenantId: string, filter: LogTailQuery, cursor: LogTailCursor | null, opts?: TailOptions): Promise<LogTailBatch> {
    return pollLogTail((q) => this.queryLogs(tenantId, q), filter, cursor, opts);
  }

  async queryRaw(tenantId: string, signal: Signal, text: string, range: TimeRange, limit: number): Promise<unknown> {
    if (signal !== 'logs') throw new TelemetryUnsupportedError(`raw ${signal} query`, this.id);
    const res = await httpRequest(this.target, this.id, 'GET', '/loki/api/v1/query_range', {
      headers: this.headers(tenantId), query: { query: text, start: msToNs(range.fromMs), end: msToNs(range.toMs), limit: String(limit) },
    });
    return parseJson(this.id, res.text);
  }

  async deleteTenantData(tenantId: string, signals?: Signal[]): Promise<DeleteResult> {
    if (signals && signals.some((s) => s !== 'logs')) throw new TelemetryUnsupportedError(`deleting ${signals.filter((s) => s !== 'logs').join(', ')}`, this.id);
    await httpRequest(this.target, this.id, 'POST', '/loki/api/v1/delete', {
      headers: this.headers(tenantId), // Loki wants `start` as unix seconds or RFC3339 and refuses `1` (and an `end` in the future); verified against Loki 3.7.8.
      query: { query: `{${TENANT_LABEL}=${quote(tenantId)}}`, start: '2000-01-01T00:00:00Z' },
    });
    return { state: 'scheduled' };
  }

  async health() {
    try {
      await httpRequest(this.target, this.id, 'GET', '/ready');
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
    }
  }

  // The signals this adapter does not serve.
  async writeSpans(): Promise<WriteResult> { throw new TelemetryUnsupportedError('traces', this.id); }
  async writeMetrics(): Promise<WriteResult> { throw new TelemetryUnsupportedError('metrics', this.id); }
  async searchTraces(_t: string, _q: TraceSearch): Promise<TraceSummary[]> { throw new TelemetryUnsupportedError('traces', this.id); }
  async getTrace(): Promise<SpanRecord[] | null> { throw new TelemetryUnsupportedError('traces', this.id); }
  async queryMetrics(_t: string, _q: MetricQuery): Promise<MetricSeries[]> { throw new TelemetryUnsupportedError('metrics', this.id); }
  async listMetricNames(): Promise<string[]> { throw new TelemetryUnsupportedError('metrics', this.id); }
  async queryExemplars(): Promise<never> { throw new TelemetryUnsupportedError('metrics', this.id); }
}

type LokiValue = [string, string, unknown?];

const tenantOf = (labels: Record<string, string>): string => labels[TENANT_LABEL] ?? '';

function parseStreams(id: string, body: unknown): LogRecord[] {
  const data = (body as { data?: { resultType?: string; result?: Array<{ stream?: Record<string, string>; values?: LokiValue[] }> } })?.data;
  if (!data || data.resultType !== 'streams' || !Array.isArray(data.result)) throw new TelemetryBackendError(`${id} returned an unexpected response`);
  const out: LogRecord[] = [];
  for (const s of data.result) {
    const labels = s.stream ?? {};
    const sev = String(labels.severity ?? '').toUpperCase();
    const severity: SeverityText = (SEVERITIES as readonly string[]).includes(sev) ? (sev as SeverityText) : 'INFO';
    for (const v of s.values ?? []) {
      if (!Array.isArray(v) || typeof v[0] !== 'string') continue;
      // Newer Loki can return per-line structured metadata as a third element; older versions merge it into the stream labels.
      const extra = (v[2] as { structuredMetadata?: Record<string, string> } | undefined)?.structuredMetadata ?? {};
      const all = { ...labels, ...extra };
      const attributes: Record<string, string> = {};
      for (const [k, val] of Object.entries(all)) if (!SCRUBBED_LABELS.has(k) && typeof val === 'string') attributes[k] = val;
      out.push({
        timeNs: v[0], severity, body: String(v[1] ?? ''), attributes, resource: { 'service.name': all.service_name ?? 'unknown_service', [TENANT_ATTR]: all[TENANT_LABEL] ?? tenantOf(labels) },
        ...(all.trace_id ? { traceId: all.trace_id } : {}), ...(all.trace_id && all.span_id ? { spanId: all.span_id } : {}),
      });
    }
  }
  return out;
}
