/**
 * Custom business metrics: a module defines a counter / gauge / histogram once and gets a handle back.
 *
 * The handle is safe at any time — before `initMetrics` ran, with METRICS_ENABLED off, or with `prom-client` missing it is a no-op; the first call
 * after the registry exists creates the underlying prom-client instance. Metrics land in the SAME registry as the built-ins (one metric system, phase 0
 * locked decision), so they share the `/internal/api/metrics` scrape.
 *
 * Guards, because a metric name or label is the one place a careless caller can hurt the whole scrape:
 *  - names are `snake_case` and may not collide with a built-in or `app_*` default metric;
 *  - a `tenantId` label is passed through the tenant-cardinality bound, other label values are the caller's responsibility but the number of DISTINCT
 *    label sets per metric is capped (overflow is dropped and warned once, never thrown).
 */
import Logger from '@kuraykaraaslan-labs/logger';
import { getMetrics, getPromClient } from './metrics';

export type CustomMetricKind = 'counter' | 'gauge' | 'histogram';

export interface CustomMetricSpec {
  name: string;
  help: string;
  labelNames?: string[];
  /** Histogram only. Defaults to the HTTP latency buckets (seconds). */
  buckets?: number[];
}

type Labels = Record<string, string | number>;

export interface CounterHandle { inc(labels?: Labels, value?: number): void }
export interface GaugeHandle { set(labels: Labels | undefined, value: number): void; inc(labels?: Labels, value?: number): void; dec(labels?: Labels, value?: number): void }
export interface HistogramHandle { observe(labels: Labels | undefined, value: number): void }

export const MAX_SERIES_PER_METRIC = 1000;
/** Label values are cut to this many characters before they identify a series (a request id or a URL in a label is a new series per call). */
export const MAX_LABEL_VALUE_LENGTH = 120;
/** One process's custom metrics together may hold this many label sets; the per-metric bound alone lets 1 000 metrics x 1 000 sets through. */
export const MAX_SERIES_TOTAL = 20_000;
/** Most label names a custom metric may declare. */
export const MAX_LABEL_NAMES = 8;
const NAME_RE = /^[a-z][a-z0-9_]*$/;
const RESERVED = new Set([
  'http_requests_total', 'http_request_duration_seconds', 'errors_total', 'tenant_usage_total', 'rate_limit_hits_total',
  'uptime_check_latency_ms', 'uptime_status', 'plugin_executions_total', 'plugin_execution_duration_seconds',
]);
const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

interface Entry { kind: CustomMetricKind; spec: CustomMetricSpec; series: Set<string>; warned: boolean; instance: unknown }
const _entries = new Map<string, Entry>();
let _totalSeries = 0;
let _totalWarned = false;
/** Label sets and samples dropped by the bounds, by reason (`series_cap`, `total_cap`, `value_cut`): the visible outcome (also in `getCustomMetricDrops`). */
const _drops = new Map<string, number>();
const drop = (reason: string) => { _drops.set(reason, (_drops.get(reason) ?? 0) + 1); };
export function getCustomMetricDrops(): Record<string, number> { return Object.fromEntries(_drops); }

/** Test seam. */
export function _resetCustomMetrics(): void { _entries.clear(); _totalSeries = 0; _totalWarned = false; _drops.clear(); }

function validate(kind: CustomMetricKind, spec: CustomMetricSpec): void {
  if (!NAME_RE.test(spec.name)) throw new Error(`[observability] invalid metric name "${spec.name}" (snake_case required)`);
  if (spec.name.startsWith('app_') || RESERVED.has(spec.name)) throw new Error(`[observability] metric name "${spec.name}" is reserved`);
  if ((spec.labelNames?.length ?? 0) > MAX_LABEL_NAMES) throw new Error(`[observability] ${spec.name} declares more than ${MAX_LABEL_NAMES} labels`);
  for (const l of spec.labelNames ?? []) {
    if (!NAME_RE.test(l) && l !== 'tenantId') throw new Error(`[observability] invalid label "${l}" on ${spec.name}`);
    if (l === 'le' || l === 'quantile') throw new Error(`[observability] label "${l}" is reserved by Prometheus (${spec.name})`);
  }
  const prev = _entries.get(spec.name);
  if (prev && (prev.kind !== kind || JSON.stringify(prev.spec.labelNames ?? []) !== JSON.stringify(spec.labelNames ?? []))) {
    throw new Error(`[observability] metric ${spec.name} is already defined with a different shape`);
  }
}

function define(kind: CustomMetricKind, spec: CustomMetricSpec): Entry {
  validate(kind, spec);
  let e = _entries.get(spec.name);
  if (!e) { e = { kind, spec, series: new Set(), warned: false, instance: null }; _entries.set(spec.name, e); }
  return e;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolve(e: Entry): any {
  if (e.instance) return e.instance;
  const m = getMetrics();
  const prom = getPromClient();
  if (!m || !prom) return null;
  const base = { name: e.spec.name, help: e.spec.help, labelNames: e.spec.labelNames ?? [], registers: [m.registry] };
  try {
    e.instance = e.kind === 'counter' ? new prom.Counter(base)
      : e.kind === 'gauge' ? new prom.Gauge(base)
        : new prom.Histogram({ ...base, buckets: e.spec.buckets ?? DEFAULT_BUCKETS });
  } catch (err) {
    // e.g. a duplicate registration from a hot reload — keep the process alive, drop the metric.
    Logger.warn(`[observability] custom metric ${e.spec.name} could not be registered: ${err instanceof Error ? err.message : String(err)}`);
    e.instance = { _dead: true };
  }
  return e.instance;
}

/** Returns the labels to use, or `null` when this call must be dropped (series cap). Mutates nothing for no-label metrics. */
function admit(e: Entry, labels: Labels | undefined, boundTenant: (t: string | null | undefined) => string): Labels | null {
  const out: Labels = { ...(labels ?? {}) };
  for (const k of Object.keys(out)) {
    const v = out[k];
    if (typeof v === 'string' && v.length > MAX_LABEL_VALUE_LENGTH) { out[k] = v.slice(0, MAX_LABEL_VALUE_LENGTH); drop('value_cut'); }
  }
  if (e.spec.labelNames?.includes('tenantId')) out.tenantId = boundTenant(out.tenantId == null ? null : String(out.tenantId));
  const key = JSON.stringify(Object.keys(out).sort().map((k) => [k, out[k]]));
  if (!e.series.has(key)) {
    if (e.series.size >= MAX_SERIES_PER_METRIC) {
      drop('series_cap');
      if (!e.warned) { e.warned = true; Logger.warn(`[observability] custom metric ${e.spec.name} hit ${MAX_SERIES_PER_METRIC} label sets — further new series are dropped`); }
      return null;
    }
    if (_totalSeries >= MAX_SERIES_TOTAL) {
      drop('total_cap');
      if (!_totalWarned) { _totalWarned = true; Logger.warn(`[observability] custom metrics together hit ${MAX_SERIES_TOTAL} label sets — further new series are dropped`); }
      return null;
    }
    e.series.add(key);
    _totalSeries += 1;
  }
  return out;
}

type Bound = (t: string | null | undefined) => string;

function call(e: Entry, bound: Bound, labels: Labels | undefined, fn: (inst: any, l: Labels) => void): void { // eslint-disable-line @typescript-eslint/no-explicit-any
  const inst = resolve(e);
  if (!inst || inst._dead) return;
  const l = admit(e, labels, bound);
  if (!l) return;
  try { fn(inst, l); } catch (err) { Logger.warn(`[observability] custom metric ${e.spec.name} rejected a sample: ${err instanceof Error ? err.message : String(err)}`); }
}

export function defineCounter(spec: CustomMetricSpec, bound: Bound): CounterHandle {
  const e = define('counter', spec);
  return { inc: (labels, value = 1) => call(e, bound, labels, (i, l) => i.inc(l, value)) };
}

export function defineGauge(spec: CustomMetricSpec, bound: Bound): GaugeHandle {
  const e = define('gauge', spec);
  return {
    set: (labels, value) => call(e, bound, labels, (i, l) => i.set(l, value)),
    inc: (labels, value = 1) => call(e, bound, labels, (i, l) => i.inc(l, value)),
    dec: (labels, value = 1) => call(e, bound, labels, (i, l) => i.dec(l, value)),
  };
}

export function defineHistogram(spec: CustomMetricSpec, bound: Bound): HistogramHandle {
  const e = define('histogram', spec);
  return { observe: (labels, value) => call(e, bound, labels, (i, l) => i.observe(l, value)) };
}
