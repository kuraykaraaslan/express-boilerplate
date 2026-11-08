/**
 * In-memory `TelemetryBackend`: the reference implementation of the port's semantics, used by tests and local development.
 * Not a production store (no persistence, a hard cap per tenant and signal, linear scans).
 */
import type { TelemetryBackend } from '../telemetry.backend';
import { TelemetryUnsupportedError } from '../telemetry.backend';
import {
  MAX_EXEMPLARS_PER_QUERY, TENANT_ATTR, type BackendCapabilities, type DeleteResult, type Exemplar, type LogQuery, type LogQueryResult, type LogRecord, type LogTailBatch, type LogTailCursor, type LogTailQuery, type MetricPoint, type MetricQuery,
  type MetricSeries, type RetentionPolicy, type Signal, type SpanRecord, type TimeRange, type TraceSearch, type TraceSummary, type WriteResult,
} from '../telemetry.types';
import { pollLogTail, type TailOptions } from '../telemetry.tail';
import {
  attrOf, histogramQuantile, matchText, mergeHistograms, nsToMs, serviceOf, severityRank, stringifyAttrs, stripTenant,
} from '../telemetry.util';

const DEFAULT_CAP = 50_000;

interface TenantStore {
  logs: LogRecord[];
  spans: SpanRecord[];
  metrics: MetricPoint[];
  retention: RetentionPolicy | null;
}

export class MemoryTelemetryBackend implements TelemetryBackend {
  readonly id = 'memory';
  readonly capabilities: BackendCapabilities = {
    signals: { logs: true, traces: true, metrics: true },
    perTenantRetention: true,
    deletion: 'tenant',
    deletableSignals: ['logs', 'traces', 'metrics'],
    rawQuery: false,
    exemplars: true,
  };

  private readonly stores = new Map<string, TenantStore>();

  constructor(private readonly cap: number = DEFAULT_CAP) {}

  private store(tenantId: string): TenantStore {
    let s = this.stores.get(tenantId);
    if (!s) {
      s = { logs: [], spans: [], metrics: [], retention: null };
      this.stores.set(tenantId, s);
    }
    return s;
  }

  private peek(tenantId: string): TenantStore | undefined {
    return this.stores.get(tenantId);
  }

  async writeLogs(tenantId: string, records: LogRecord[]): Promise<WriteResult> {
    const s = this.store(tenantId);
    for (const r of records) s.logs.push({ ...r, attributes: stripTenant(r.attributes), resource: { ...stripTenant(r.resource), [TENANT_ATTR]: tenantId } });
    if (s.logs.length > this.cap) s.logs.splice(0, s.logs.length - this.cap);
    return { accepted: records.length, rejected: 0 };
  }

  async writeSpans(tenantId: string, spans: SpanRecord[]): Promise<WriteResult> {
    const s = this.store(tenantId);
    for (const sp of spans) s.spans.push({ ...sp, attributes: stripTenant(sp.attributes), resource: { ...stripTenant(sp.resource), [TENANT_ATTR]: tenantId } });
    if (s.spans.length > this.cap) s.spans.splice(0, s.spans.length - this.cap);
    return { accepted: spans.length, rejected: 0 };
  }

  async writeMetrics(tenantId: string, points: MetricPoint[]): Promise<WriteResult> {
    const s = this.store(tenantId);
    for (const p of points) s.metrics.push({ ...p, attributes: stripTenant(p.attributes), resource: { ...stripTenant(p.resource), [TENANT_ATTR]: tenantId } });
    if (s.metrics.length > this.cap) s.metrics.splice(0, s.metrics.length - this.cap);
    return { accepted: points.length, rejected: 0 };
  }

  async queryLogs(tenantId: string, q: LogQuery): Promise<LogQueryResult> {
    const s = this.peek(tenantId);
    if (!s) return { records: [], truncated: false };
    const minRank = q.severityMin ? severityRank(q.severityMin) : -1;
    const hits = s.logs.filter((r) => {
      const ms = nsToMs(r.timeNs);
      if (ms < q.range.fromMs || ms >= q.range.toMs) return false;
      if (q.service && serviceOf(r.resource) !== q.service) return false;
      if (severityRank(r.severity) < minRank) return false;
      if (q.traceId && r.traceId !== q.traceId) return false;
      for (const t of q.text) if (!r.body.includes(t)) return false;
      for (const f of q.filters) {
        const v = attrOf(r.attributes, r.resource, f.field);
        if (v === undefined) {
          if (f.op !== 'neq') return false;
          continue;
        }
        if (!matchText(String(v), f.op, f.value)) return false;
      }
      return true;
    });
    hits.sort((a, b) => (a.timeNs === b.timeNs ? 0 : BigInt(a.timeNs) < BigInt(b.timeNs) ? -1 : 1));
    if (q.direction === 'newest') hits.reverse();
    return { records: hits.slice(0, q.limit), truncated: hits.length > q.limit };
  }

  tailLogs(tenantId: string, filter: LogTailQuery, cursor: LogTailCursor | null, opts?: TailOptions): Promise<LogTailBatch> {
    return pollLogTail((q) => this.queryLogs(tenantId, q), filter, cursor, opts);
  }

  private traceGroups(s: TenantStore): Map<string, SpanRecord[]> {
    const m = new Map<string, SpanRecord[]>();
    for (const sp of s.spans) {
      const list = m.get(sp.traceId);
      if (list) list.push(sp); else m.set(sp.traceId, [sp]);
    }
    return m;
  }

  private summarize(traceId: string, spans: SpanRecord[]): TraceSummary {
    const byId = new Set(spans.map((x) => x.spanId));
    const root = spans.find((x) => !x.parentSpanId || !byId.has(x.parentSpanId)) ?? spans[0]!;
    const start = Math.min(...spans.map((x) => nsToMs(x.startNs)));
    const end = Math.max(...spans.map((x) => nsToMs(x.endNs)));
    return {
      traceId, rootService: serviceOf(root.resource), rootName: root.name, startMs: start, durationMs: Math.max(0, end - start),
      spanCount: spans.length, errorCount: spans.filter((x) => x.status === 'ERROR').length,
    };
  }

  async searchTraces(tenantId: string, q: TraceSearch): Promise<TraceSummary[]> {
    const s = this.peek(tenantId);
    if (!s) return [];
    const out: TraceSummary[] = [];
    for (const [traceId, spans] of this.traceGroups(s)) {
      const sum = this.summarize(traceId, spans);
      if (sum.startMs < q.range.fromMs || sum.startMs >= q.range.toMs) continue;
      if (q.minDurationMs !== undefined && sum.durationMs < q.minDurationMs) continue;
      if (q.maxDurationMs !== undefined && sum.durationMs > q.maxDurationMs) continue;
      const spanMatches = spans.some((sp) => {
        if (q.service && serviceOf(sp.resource) !== q.service) return false;
        if (q.name && sp.name !== q.name) return false;
        if (q.status === 'error' && sp.status !== 'ERROR') return false;
        if (q.status === 'ok' && sp.status === 'ERROR') return false;
        for (const a of q.attributes) {
          const v = attrOf(sp.attributes, sp.resource, a.key);
          if (v === undefined || String(v) !== a.value) return false;
        }
        return true;
      });
      if (spanMatches) out.push(sum);
    }
    out.sort((a, b) => b.startMs - a.startMs);
    return out.slice(0, q.limit);
  }

  async getTrace(tenantId: string, traceId: string): Promise<SpanRecord[] | null> {
    const s = this.peek(tenantId);
    if (!s) return null;
    const spans = s.spans.filter((x) => x.traceId === traceId);
    return spans.length ? spans : null;
  }

  async queryMetrics(tenantId: string, q: MetricQuery): Promise<MetricSeries[]> {
    const s = this.peek(tenantId);
    if (!s) return [];
    const stepMs = q.stepSeconds * 1000;
    const groups = new Map<string, { labels: Record<string, string>; buckets: Map<number, MetricPoint[]> }>();
    for (const p of s.metrics) {
      if (p.name !== q.metric || p.timeMs < q.range.fromMs || p.timeMs >= q.range.toMs) continue;
      const labels = stringifyAttrs(stripTenant({ ...p.resource, ...p.attributes }));
      let ok = true;
      for (const f of q.filters) {
        const v = labels[f.field];
        if (f.op === 'eq' ? v !== f.value : v === f.value) { ok = false; break; }
      }
      if (!ok) continue;
      const groupLabels = Object.fromEntries(q.groupBy.filter((g) => labels[g] !== undefined).map((g) => [g, labels[g]!]));
      const key = JSON.stringify(groupLabels);
      let g = groups.get(key);
      if (!g) { g = { labels: groupLabels, buckets: new Map() }; groups.set(key, g); }
      const b = Math.floor((p.timeMs - q.range.fromMs) / stepMs);
      const arr = g.buckets.get(b);
      if (arr) arr.push(p); else g.buckets.set(b, [p]);
    }
    const series: MetricSeries[] = [];
    for (const g of groups.values()) {
      const points: Array<[number, number]> = [];
      for (const [b, pts] of [...g.buckets.entries()].sort((x, y) => x[0] - y[0])) {
        const v = aggregate(q, pts);
        if (v !== null && Number.isFinite(v)) points.push([q.range.fromMs + b * stepMs, v]);
      }
      if (points.length) series.push({ metric: q.metric, labels: g.labels, points });
    }
    return series;
  }

  async queryExemplars(tenantId: string, q: MetricQuery): Promise<Exemplar[]> {
    const s = this.peek(tenantId);
    if (!s) return [];
    const out: Exemplar[] = [];
    for (const p of s.metrics) {
      if (!p.exemplars?.length || p.name !== q.metric || p.timeMs < q.range.fromMs || p.timeMs >= q.range.toMs) continue;
      const labels = stringifyAttrs(stripTenant({ ...p.resource, ...p.attributes }));
      if (q.filters.some((f) => (f.op === 'eq' ? labels[f.field] !== f.value : labels[f.field] === f.value))) continue;
      const seriesLabels = Object.fromEntries(q.groupBy.filter((g) => labels[g] !== undefined).map((g) => [g, labels[g]!]));
      for (const e of p.exemplars) if (e.timeMs >= q.range.fromMs && e.timeMs < q.range.toMs) out.push({ ...e, labels: seriesLabels });
    }
    return out.sort((a, b) => b.timeMs - a.timeMs).slice(0, MAX_EXEMPLARS_PER_QUERY);
  }

  async listMetricNames(tenantId: string, range: TimeRange): Promise<string[]> {
    const s = this.peek(tenantId);
    if (!s) return [];
    return [...new Set(s.metrics.filter((p) => p.timeMs >= range.fromMs && p.timeMs < range.toMs).map((p) => p.name))].sort();
  }

  async setRetention(tenantId: string, policy: RetentionPolicy): Promise<void> {
    this.store(tenantId).retention = policy;
  }

  /** Applies every tenant's retention policy as of `nowMs` (the production backends do this themselves). */
  purgeExpired(nowMs: number): void {
    for (const s of this.stores.values()) {
      const days = s.retention?.days;
      if (!days) continue;
      const cut = (d?: number) => (d === undefined ? -Infinity : nowMs - d * 86_400_000);
      s.logs = s.logs.filter((r) => nsToMs(r.timeNs) >= cut(days.logs));
      s.spans = s.spans.filter((x) => nsToMs(x.endNs) >= cut(days.traces));
      s.metrics = s.metrics.filter((p) => p.timeMs >= cut(days.metrics));
    }
  }

  async deleteTenantData(tenantId: string, signals?: Signal[]): Promise<DeleteResult> {
    const s = this.peek(tenantId);
    if (!s) return { state: 'done', removed: 0 };
    const which = new Set<Signal>(signals ?? ['logs', 'traces', 'metrics']);
    let removed = 0;
    if (which.has('logs')) { removed += s.logs.length; s.logs = []; }
    if (which.has('traces')) { removed += s.spans.length; s.spans = []; }
    if (which.has('metrics')) { removed += s.metrics.length; s.metrics = []; }
    return { state: 'done', removed };
  }

  async queryRaw(): Promise<unknown> {
    throw new TelemetryUnsupportedError('queryRaw', this.id);
  }

  async health() {
    return { ok: true };
  }
}

function aggregate(q: MetricQuery, pts: MetricPoint[]): number | null {
  const hist = pts.filter((p) => p.kind === 'histogram' && p.histogram).map((p) => p.histogram!);
  if (q.aggregation.startsWith('p') && hist.length) {
    const merged = mergeHistograms(hist);
    return merged ? histogramQuantile(Number(q.aggregation.slice(1)) / 100, merged) : null;
  }
  const vals = pts.map((p) => (p.kind === 'histogram' ? (p.histogram ? p.histogram.sum / Math.max(1, p.histogram.count) : NaN) : p.value ?? NaN)).filter(Number.isFinite);
  if (!vals.length) return null;
  switch (q.aggregation) {
    case 'sum': case 'total': return vals.reduce((a, b) => a + b, 0);
    case 'q50': case 'q75': case 'q90': case 'q95': return rawQuantile(vals, Number(q.aggregation.slice(1)) / 100);
    case 'avg': return vals.reduce((a, b) => a + b, 0) / vals.length;
    case 'min': return Math.min(...vals);
    case 'max': return Math.max(...vals);
    case 'count': return pts.length;
    case 'increase': return Math.max(...vals) - Math.min(...vals);
    case 'rate': {
      const times = pts.map((p) => p.timeMs);
      const span = (Math.max(...times) - Math.min(...times)) / 1000;
      return span > 0 ? (Math.max(...vals) - Math.min(...vals)) / span : 0;
    }
    default: return null;
  }
}

/** Quantile of raw observations with linear interpolation between ranks (what PromQL's `quantile_over_time` does). */
export function rawQuantile(values: number[], q: number): number {
  const v = [...values].sort((a, b) => a - b);
  if (v.length === 1) return v[0]!;
  const rank = q * (v.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return v[lo]! + (v[hi]! - v[lo]!) * (rank - lo);
}
