/**
 * Prometheus metrics lazy initialiser. The `prom-client` package is imported
 * only when `METRICS_ENABLED=true` — no runtime cost when off, and the boilerplate
 * compiles cleanly even without the dependency installed.
 *
 * Exposes four default metrics:
 *   - http_requests_total                (counter, labels: method, route, status, tenantId)
 *   - http_request_duration_seconds      (histogram, labels: method, route, status; no tenantId, each series costs 11 buckets)
 *   - errors_total                       (counter, labels: tenantId, errorClass)
 *   - tenant_usage_total                 (counter, labels: tenantId, metric)
 *
 * Scraped by `/internal/api/metrics`.
 */
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { prepareExemplars } from './telemetry/telemetry.exemplars'

// Loose runtime-only types so we don't take a compile-time dep on `prom-client`.
// The actual package is `await import('prom-client')` below.
type AnyCounter = { inc: (labels: Record<string, string | number>, value?: number) => void };
type AnyHistogram = { observe: (labels: Record<string, string | number>, value: number) => void };
type AnyGauge = { set: (labels: Record<string, string | number>, value: number) => void };
type AnyRegistry = {
  contentType: string;
  metrics: () => Promise<string>;
};

export interface MetricBundle {
  registry: AnyRegistry;
  httpRequests: AnyCounter;
  httpDuration: AnyHistogram;
  errors: AnyCounter;
  tenantUsage: AnyCounter;
  rateLimitHits: AnyCounter;
  uptimeLatency: AnyHistogram;
  uptimeStatus: AnyGauge;
  pluginExecutions: AnyCounter;
  pluginDuration: AnyHistogram;
}

/**
 * Gauges whose value is READ at scrape time (control-plane counts and the like) rather than pushed. A module registers a source at boot; each scrape
 * calls `read()` and replaces the gauge's series, so a state that disappears (an alert that resolves) disappears from the output instead of freezing.
 * The registry may not exist yet (metrics disabled, first scrape pending): sources are kept and attached when it is created. A failing `read()` leaves
 * the previous scrape's series out rather than failing the scrape.
 */
export interface GaugeSource {
  name: string;
  help: string;
  labelNames: string[];
  read(): Promise<Array<{ labels: Record<string, string>; value: number }>>;
}
const _sources = new Map<string, GaugeSource>();
const _attached = new Set<string>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _prom: any = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function attachSource(s: GaugeSource, registry: any): void {
  if (_attached.has(s.name) || !_prom) return;
  _attached.add(s.name);
  new _prom.Gauge({
    name: s.name, help: s.help, labelNames: s.labelNames, registers: [registry],
    async collect(this: { reset(): void; set(l: Record<string, string>, v: number): void }) {
      this.reset();
      try { for (const r of await s.read()) this.set(r.labels, r.value); } catch (err) { Logger.warn(`[observability] gauge ${s.name} read failed: ${err instanceof Error ? err.message : String(err)}`); }
    },
  });
}

export function registerGaugeSource(source: GaugeSource): void {
  _sources.set(source.name, source);
  if (_bundle) attachSource(source, _bundle.registry);
}

let _bundle: MetricBundle | null = null;
let _initialized = false;

export async function initMetrics(): Promise<MetricBundle | null> {
  if (_initialized) return _bundle;
  _initialized = true;

  if (!env.METRICS_ENABLED) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prom: any = await import('prom-client' as string);
    _prom = prom;
    const registry = new prom.Registry();
    // Opt-in (TELEMETRY_EXEMPLARS): switches the registry to OpenMetrics BEFORE any histogram exists and returns the option the request histogram needs.
    const exemplar = prepareExemplars(prom, registry);
    prom.collectDefaultMetrics({ register: registry, prefix: 'app_' });

    const httpRequests: AnyCounter = new prom.Counter({
      name: 'http_requests_total',
      help: 'Total HTTP requests received',
      labelNames: ['method', 'route', 'status', 'tenantId'],
      registers: [registry],
    });
    const httpDuration: AnyHistogram = new prom.Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request latency',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
      ...exemplar,
    });
    const errors: AnyCounter = new prom.Counter({
      name: 'errors_total',
      help: 'Application errors captured by ObservabilityService',
      labelNames: ['tenantId', 'errorClass'],
      registers: [registry],
    });
    const tenantUsage: AnyCounter = new prom.Counter({
      name: 'tenant_usage_total',
      help: 'Per-tenant resource usage counter',
      labelNames: ['tenantId', 'metric'],
      registers: [registry],
    });
    const rateLimitHits: AnyCounter = new prom.Counter({
      name: 'rate_limit_hits_total',
      help: 'Rate-limit rejections by scope',
      labelNames: ['scope', 'tenantId'],
      registers: [registry],
    });
    // Uptime probe results (phase 0.4) live in THIS registry — the locked
    // decision is one metric system, so the probe writes here, never its own.
    const uptimeLatency: AnyHistogram = new prom.Histogram({
      name: 'uptime_check_latency_ms',
      help: 'Uptime probe latency per monitor (milliseconds)',
      labelNames: ['tenantId', 'monitorId'],
      buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [registry],
    });
    const uptimeStatus: AnyGauge = new prom.Gauge({
      name: 'uptime_status',
      help: 'Debounced monitor status: 1=UP, 0.5=DEGRADED, 0=DOWN, -1=UNKNOWN',
      labelNames: ['tenantId', 'monitorId'],
      registers: [registry],
    });

    // Sandboxed-plugin executions (marketplace §6D): crash rate = executions
    // with outcome error|timeout over total; latency percentiles from the
    // histogram. pluginId cardinality is bounded by the installed catalog.
    const pluginExecutions: AnyCounter = new prom.Counter({
      name: 'plugin_executions_total',
      help: 'Sandboxed plugin executions by outcome (ok | error | timeout)',
      labelNames: ['tenantId', 'pluginId', 'kind', 'outcome'],
      registers: [registry],
    });
    const pluginDuration: AnyHistogram = new prom.Histogram({
      name: 'plugin_execution_duration_seconds',
      help: 'Sandboxed plugin execution latency',
      labelNames: ['tenantId', 'pluginId', 'kind'],
      buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    });

    for (const src of _sources.values()) attachSource(src, registry);
    _bundle = { registry, httpRequests, httpDuration, errors, tenantUsage, rateLimitHits, uptimeLatency, uptimeStatus, pluginExecutions, pluginDuration };
    Logger.info('[observability] Prometheus registry initialised');
    return _bundle;
  } catch (err) {
    Logger.warn(
      `[observability] prom-client not installed — METRICS_ENABLED=true but the package is missing. ` +
        `Install with: npm install prom-client. ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

export function getMetrics(): MetricBundle | null {
  return _bundle;
}

/** The loaded `prom-client` namespace; `null` until `initMetrics` succeeded. Lets sibling files build metrics on the same registry. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPromClient(): any {
  return _prom;
}
