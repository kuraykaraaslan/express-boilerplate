import type {
  DashboardDataSource, DataSourceContext, DataSourceQueryDef, DataSourceResult, ResolvedQuery,
} from '@kuraykaraaslan-labs/dashboard/server/data-source.types';
import { requireBackend } from './telemetry.http';
import { getTelemetryLimits } from './telemetry.limits';
import { listMetricNames, queryLogs, queryMetrics, searchTraces, serviceMap, type QueryDeps } from './telemetry.query.service';
import type { ServiceRed } from './telemetry.servicemap';
import { METRIC_AGGREGATIONS, type MetricSeries } from './telemetry.types';

/**
 * `dashboard:data_source` contribution (phase 18.4): the workspace's own telemetry as board data. Type-only import of the host's shapes, so the
 * contribution is inert while `dashboard` is off and adds no edge onto it (EXT-14).
 *
 * Every query goes through the same service as the explorer routes, so the caps, the tenant scoping and the structured-query validation are
 * the same code: a board binding can only ask what `observability.telemetry.read` already allows, with `ctx.tenantId` as the only tenant.
 * Cache scope is `tenant`: the figures do not depend on who looks.
 */

const deps: QueryDeps = { backend: requireBackend, limits: getTelemetryLimits };
const PERMISSION = 'observability.telemetry.read';

/** The board window when there is one, else the last hour (the params of a query carry no range of their own). */
function rangeOf(ctx: DataSourceContext): { fromMs: number; toMs: number } {
  if (ctx.window) {
    const from = Date.parse(ctx.window.from);
    const to = Date.parse(ctx.window.to);
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) return { fromMs: from, toMs: to };
  }
  const now = Date.now();
  return { fromMs: now - 3_600_000, toMs: now };
}

/** A step that keeps a series at about 120 points, never below 15 s. */
function stepFor(range: { fromMs: number; toMs: number }): number {
  return Math.max(15, Math.ceil((range.toMs - range.fromMs) / 1000 / 120));
}

/** The figures `service_red_value` can answer, all derived from the same sample of recent traces as the Services table. */
const RED_MEASURES = [
  { key: 'ratePerSecond', label: 'Requests per second' },
  { key: 'requests', label: 'Requests' },
  { key: 'errorRate', label: 'Error rate (0 to 1)' },
  { key: 'errors', label: 'Errors' },
  { key: 'p50Ms', label: 'p50 duration (ms)' },
  { key: 'p95Ms', label: 'p95 duration (ms)' },
  { key: 'p99Ms', label: 'p99 duration (ms)' },
] as const;
type RedMeasure = (typeof RED_MEASURES)[number]['key'];

const QUERIES: DataSourceQueryDef[] = [
  {
    key: 'metric_series', label: 'Metric over time', shape: 'series', requiredPermission: PERMISSION, window: 'board', defaultTtlSeconds: 30, cacheScope: 'tenant',
    params: {
      metric: { label: 'Metric name', type: 'text', required: true },
      aggregation: { label: 'Aggregation', type: 'select', value: 'avg', options: METRIC_AGGREGATIONS.map((a) => ({ label: a, value: a })) },
      groupBy: { label: 'Group by (one attribute, empty = none)', type: 'text' },
      filterField: { label: 'Only where this attribute (empty = no filter)', type: 'text' },
      filterValue: { label: '... equals (* = any)', type: 'text' },
    },
  },
  {
    key: 'metric_value', label: 'Metric, one number', shape: 'scalar', requiredPermission: PERMISSION, window: 'board', defaultTtlSeconds: 30, cacheScope: 'tenant',
    params: {
      metric: { label: 'Metric name', type: 'text', required: true },
      aggregation: { label: 'Aggregation', type: 'select', value: 'avg', options: METRIC_AGGREGATIONS.map((a) => ({ label: a, value: a })) },
      filterField: { label: 'Only where this attribute (empty = no filter)', type: 'text' },
      filterValue: { label: '... equals (* = any)', type: 'text' },
      scale: { label: 'Multiply by (100 turns a ratio into a percentage)', type: 'number', value: 1, min: 0, max: 1_000_000 },
    },
  },
  {
    key: 'service_red_value', label: 'Service figure from traces (one number)', shape: 'scalar', requiredPermission: PERMISSION, window: 'board', defaultTtlSeconds: 60, cacheScope: 'tenant',
    params: {
      service: { label: 'Service (empty or * = all services together)', type: 'text' },
      measure: { label: 'Figure', type: 'select', value: 'ratePerSecond', required: true, options: RED_MEASURES.map((m) => ({ label: m.label, value: m.key })) },
    },
  },
  {
    key: 'recent_errors', label: 'Recent error logs', shape: 'table', requiredPermission: PERMISSION, window: 'board', defaultTtlSeconds: 30, cacheScope: 'tenant',
    params: { service: { label: 'Service (empty or * = all)', type: 'text' } },
  },
  {
    key: 'failing_traces', label: 'Failing traces', shape: 'table', requiredPermission: PERMISSION, window: 'board', defaultTtlSeconds: 30, cacheScope: 'tenant',
    params: { service: { label: 'Service (empty or * = all)', type: 'text' } },
  },
  {
    key: 'service_red', label: 'Services: rate, errors, duration', shape: 'table', requiredPermission: PERMISSION, window: 'board', defaultTtlSeconds: 60, cacheScope: 'tenant',
    params: {},
  },
  {
    key: 'metric_names', label: 'Metric names', shape: 'table', requiredPermission: PERMISSION, window: 'board', defaultTtlSeconds: 120, cacheScope: 'tenant',
    params: {},
  },
];

/** `filterField` / `filterValue` as the one equality filter the metric query takes (both or neither). */
function metricFilter(params: Record<string, unknown>): Array<{ field: string; op: 'eq'; value: string }> {
  const field = str(params.filterField);
  const value = scoped(params.filterValue);
  return field && value ? [{ field, op: 'eq', value }] : [];
}

/**
 * One figure out of the per-service RED rows. For one service it is that service's row; for none ("all services together") counts are
 * summed, the rate is recomputed from the summed count, the error rate is errors over requests, and a percentile is the largest of the
 * services' (a conservative bound: the true overall percentile cannot be rebuilt from per-service percentiles).
 */
export function redValue(rows: ServiceRed[], service: string | undefined, measure: RedMeasure, rangeMs: number): number | null {
  const picked = service ? rows.filter((r) => r.service === service) : rows;
  if (picked.length === 0) return null;
  const sum = (f: (r: ServiceRed) => number) => picked.reduce((a, r) => a + f(r), 0);
  switch (measure) {
    case 'requests': return sum((r) => r.requests);
    case 'errors': return sum((r) => r.errors);
    case 'errorRate': { const n = sum((r) => r.requests); return n ? Math.round((sum((r) => r.errors) / n) * 10_000) / 10_000 : 0; }
    case 'ratePerSecond': return Math.round((sum((r) => r.requests) / Math.max(1, rangeMs / 1000)) * 10_000) / 10_000;
    case 'p50Ms': case 'p95Ms': case 'p99Ms': return Math.max(...picked.map((r) => r[measure]));
  }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/**
 * A board parameter cannot be empty (the dashboard treats an empty value as "no value" and refuses the cards that reference it), so a scoping
 * parameter such as the service or the host uses `*` for "all". A real service or host can still be named; `*` alone means no filter.
 */
export const ALL = '*';
const scoped = (v: unknown): string | undefined => { const s = str(v); return s === ALL ? undefined : s; };

function seriesResult(series: MetricSeries[]): DataSourceResult {
  return {
    shape: 'series', fetchedAt: new Date().toISOString(),
    series: series.map((s) => ({ name: Object.values(s.labels).join(' / ') || s.metric, points: s.points.map(([t, v]) => ({ t: new Date(t).toISOString(), v })) })),
  };
}

const source: DashboardDataSource = {
  key: 'telemetry',

  async describe(): Promise<DataSourceQueryDef[]> {
    return QUERIES;
  },

  async execute(ctx: DataSourceContext, q: ResolvedQuery): Promise<DataSourceResult> {
    // The runner already validated `params` against the declared schema and the permission; the service validates again as data.
    const range = rangeOf(ctx);
    const now = new Date().toISOString();
    switch (q.queryKey) {
      case 'metric_series': {
        const groupBy = str(q.params.groupBy);
        const { series } = await queryMetrics(deps, ctx.tenantId, {
          range, stepSeconds: stepFor(range), metric: str(q.params.metric) ?? '', aggregation: str(q.params.aggregation) ?? 'avg', groupBy: groupBy ? [groupBy] : [],
          filters: metricFilter(q.params),
        });
        return seriesResult(series);
      }
      case 'metric_value': {
        // One number: the value of the final step of the window, where the step is as long as the window allows, so a window of a day or
        // less is a single bucket (the aggregation over the whole window).
        const { series } = await queryMetrics(deps, ctx.tenantId, {
          range, stepSeconds: Math.min(86_400, Math.max(1, Math.ceil((range.toMs - range.fromMs) / 1000))), metric: str(q.params.metric) ?? '',
          aggregation: str(q.params.aggregation) ?? 'avg', groupBy: [], filters: metricFilter(q.params),
        });
        const values = series.map((s) => s.points.at(-1)?.[1]).filter((v): v is number => typeof v === 'number');
        const scale = typeof q.params.scale === 'number' && Number.isFinite(q.params.scale) ? q.params.scale : 1;
        // Several series (a metric with labels and no filter) are summed: "the figure for everything this tenant sends".
        return { shape: 'scalar', fetchedAt: now, value: values.length ? Math.round(values.reduce((a, b) => a + b, 0) * scale * 10_000) / 10_000 : null };
      }
      case 'service_red_value': {
        const service = scoped(q.params.service);
        const measure = RED_MEASURES.find((m) => m.key === q.params.measure)?.key ?? 'ratePerSecond';
        const r = await serviceMap(deps, ctx.tenantId, { range, traceLimit: 30 });
        return { shape: 'scalar', fetchedAt: now, value: redValue(r.red, service, measure, range.toMs - range.fromMs) };
      }
      case 'recent_errors': {
        const service = scoped(q.params.service);
        const r = await queryLogs(deps, ctx.tenantId, { range, limit: 20, severityMin: 'ERROR', ...(service ? { service } : {}) });
        return {
          shape: 'table', fetchedAt: now,
          columns: [{ key: 'time', label: 'Time', type: 'date' }, { key: 'service', label: 'Service', type: 'text' }, { key: 'message', label: 'Message', type: 'text' }],
          rows: r.records.map((l) => ({ time: new Date(Number(BigInt(l.timeNs) / BigInt(1_000_000))).toISOString(), service: String(l.resource['service.name'] ?? ''), message: l.body.slice(0, 300) })),
        };
      }
      case 'failing_traces': {
        const service = scoped(q.params.service);
        const r = await searchTraces(deps, ctx.tenantId, { range, limit: 20, status: 'error', ...(service ? { service } : {}) });
        return {
          shape: 'table', fetchedAt: now,
          columns: [{ key: 'time', label: 'Time', type: 'date' }, { key: 'service', label: 'Service', type: 'text' }, { key: 'name', label: 'Root span', type: 'text' }, { key: 'durationMs', label: 'Duration (ms)', type: 'number' }],
          rows: r.traces.map((t) => ({ time: new Date(t.startMs).toISOString(), service: t.rootService, name: t.rootName, durationMs: Math.round(t.durationMs) })),
        };
      }
      case 'service_red': {
        const r = await serviceMap(deps, ctx.tenantId, { range, traceLimit: 30 });
        return {
          shape: 'table', fetchedAt: now,
          columns: [{ key: 'service', label: 'Service', type: 'text' }, { key: 'requests', label: 'Requests', type: 'number' }, { key: 'errorRate', label: 'Error rate', type: 'number' }, { key: 'p95Ms', label: 'p95 (ms)', type: 'number' }],
          rows: r.red.map((s) => ({ service: s.service, requests: s.requests, errorRate: s.errorRate, p95Ms: s.p95Ms })),
        };
      }
      case 'metric_names': {
        const { names } = await listMetricNames(deps, ctx.tenantId, range);
        return { shape: 'table', fetchedAt: now, columns: [{ key: 'name', label: 'Metric', type: 'text' }], rows: names.slice(0, 200).map((name) => ({ name })) };
      }
      default:
        throw new Error(`unknown telemetry query: ${q.queryKey}`);
    }
  },
};

export default source;
