/**
 * `exportGlobalSafe()` (docs/phases/02-fleet/01-data-classification.md section 3, O-4): the only way numbers about a node's HTTP traffic reach the control plane.
 * Class G means no label, no free string and nothing a customer could be recognised by, so this is not "the registry with the labels stripped": it is a CLOSED set of
 * integer series, built here from the in-process registry, and nothing else can come out of it. A new series needs a new name in `GLOBAL_METRIC_NAMES` (and the
 * same name in the agent's allowlist, which a test keeps equal).
 *
 * The definitions are those of `infra/observability/node/rules/recording.yml`, over the same 5 minute window, all routes and tenants together, so the regional
 * Grafana and the control plane cannot disagree about one node:
 *  - `http_requests_per_minute`    requests per minute (node:http_requests:rate5m x 60, rounded);
 *  - `http_error_rate_permille`    5xx responses per thousand requests, only when there was traffic;
 *  - `http_request_p50_ms`, `_p95_ms`, `_p99_ms`  percentiles of `http_request_duration_seconds`, in milliseconds, by `histogram_quantile` interpolation;
 *  - `queue_failed_jobs`           BullMQ jobs that failed in the same 5 minutes, every queue of the node together (`queue.failed.ts`, X4-6): read from Redis, not
 *                                  from the registry, so it is there with metrics off and right after a restart, and absent when Redis does not answer.
 *
 * "Nothing recorded" is absence, never zero: a series is omitted until the window holds enough history (at least `MIN_SPAN_SECONDS`) and, for the ones that need
 * traffic, until there was some. The window is in memory: a process restart (or a counter reset) starts it again.
 */
export const GLOBAL_METRIC_NAMES = [
  'http_requests_per_minute', 'http_error_rate_permille', 'http_request_p50_ms', 'http_request_p95_ms', 'http_request_p99_ms', 'queue_failed_jobs',
] as const;
export type GlobalMetricName = (typeof GLOBAL_METRIC_NAMES)[number];

export const GLOBAL_WINDOW_SECONDS = 300;
export const MIN_SPAN_SECONDS = 30;

/** The slice of prom-client's `getMetricsAsJSON()` this reads. */
export interface RawMetric { name: string; values: Array<{ value: number; labels?: Record<string, string | number>; metricName?: string }> }

export interface Sample { atMs: number; requests: number; errors: number; /** cumulative count per upper bound (le), summed over every other label */ buckets: Map<number, number> }

const numeric = (le: string | number | undefined): number | null => {
  if (le === '+Inf' || le === 'Inf') return Number.POSITIVE_INFINITY;
  const n = typeof le === 'number' ? le : Number(le);
  return Number.isFinite(n) ? n : null;
};

export function sampleFrom(raw: readonly RawMetric[], atMs: number): Sample {
  let requests = 0; let errors = 0;
  const buckets = new Map<number, number>();
  for (const m of raw) {
    if (m.name === 'http_requests_total') {
      for (const v of m.values) {
        requests += v.value;
        if (/^5\d\d$/.test(String(v.labels?.status ?? ''))) errors += v.value;
      }
    } else if (m.name === 'http_request_duration_seconds') {
      for (const v of m.values) {
        if (v.metricName !== 'http_request_duration_seconds_bucket') continue;
        const le = numeric(v.labels?.le);
        if (le === null) continue;
        buckets.set(le, (buckets.get(le) ?? 0) + v.value);
      }
    }
  }
  return { atMs, requests, errors, buckets };
}

/** `histogram_quantile` over cumulative bucket counts: linear interpolation inside the bucket, the highest finite bound for the `+Inf` bucket. */
export function quantileSeconds(q: number, cumulative: ReadonlyMap<number, number>): number | null {
  const bounds = [...cumulative.keys()].sort((a, b) => a - b);
  const total = cumulative.get(Number.POSITIVE_INFINITY);
  if (!total || total <= 0) return null;
  const rank = q * total;
  let prevBound = 0; let prevCount = 0;
  for (const b of bounds) {
    const count = cumulative.get(b)!;
    if (count >= rank) {
      if (b === Number.POSITIVE_INFINITY) return prevBound;
      if (count === prevCount) return b;
      return prevBound + (b - prevBound) * ((rank - prevCount) / (count - prevCount));
    }
    prevBound = b; prevCount = count;
  }
  return prevBound;
}

export class GlobalMetricsWindow {
  private samples: Sample[] = [];

  /** Records a sample and answers the series the window supports now. */
  push(sample: Sample): Partial<Record<GlobalMetricName, number>> {
    const last = this.samples[this.samples.length - 1];
    // A counter that went DOWN is a restart or a reset: what came before is not comparable with what comes after.
    if (last && (sample.requests < last.requests || sample.errors < last.errors)) this.samples = [];
    this.samples.push(sample);
    const horizon = sample.atMs - GLOBAL_WINDOW_SECONDS * 1000;
    // keep the newest sample at or before the horizon as the baseline, and everything after it
    const firstInside = this.samples.findIndex((s) => s.atMs > horizon);
    if (firstInside > 1) this.samples = this.samples.slice(firstInside - 1);
    return this.series(sample);
  }

  private series(now: Sample): Partial<Record<GlobalMetricName, number>> {
    const base = this.samples[0]!;
    const spanSeconds = (now.atMs - base.atMs) / 1000;
    if (base === now || spanSeconds < MIN_SPAN_SECONDS) return {};
    const out: Partial<Record<GlobalMetricName, number>> = {};
    const requests = now.requests - base.requests;
    out.http_requests_per_minute = Math.round((requests / spanSeconds) * 60);
    if (requests > 0) out.http_error_rate_permille = Math.round(((now.errors - base.errors) / requests) * 1000);
    const delta = new Map<number, number>();
    for (const [le, count] of now.buckets) delta.set(le, Math.max(0, count - (base.buckets.get(le) ?? 0)));
    for (const [name, q] of [['http_request_p50_ms', 0.5], ['http_request_p95_ms', 0.95], ['http_request_p99_ms', 0.99]] as const) {
      const s = quantileSeconds(q, delta);
      if (s !== null) out[name] = Math.round(s * 1000);
    }
    return out;
  }
}

/** Builds the export from raw metrics: only the closed set, only safe integers. */
export function globalSafeFrom(window: GlobalMetricsWindow, raw: readonly RawMetric[], nowMs: number): Record<string, number> {
  const series = window.push(sampleFrom(raw, nowMs));
  const out: Record<string, number> = {};
  for (const name of GLOBAL_METRIC_NAMES) {
    const v = series[name];
    if (v !== undefined && Number.isSafeInteger(v) && v >= 0) out[name] = v;
  }
  return out;
}

const processWindow = new GlobalMetricsWindow();
let processQueueFailed: ((nowMs: number) => Promise<number | undefined>) | null = null;

/** Adds `queue_failed_jobs` to an export when the reading is a measurement (a non-negative safe integer); absent otherwise, never zero. */
export function withQueueFailed(out: Record<string, number>, queueFailed: number | undefined): Record<string, number> {
  if (queueFailed !== undefined && Number.isSafeInteger(queueFailed) && queueFailed >= 0) out.queue_failed_jobs = queueFailed;
  return out;
}

async function httpSeries(nowMs: number): Promise<Record<string, number>> {
  try {
    // loaded here: the registry module pulls the logger and so the whole environment, which the pure parts above (and their tests) must not need
    const { getMetrics } = await import('./metrics');
    const registry = getMetrics()?.registry as unknown as { getMetricsAsJSON?: () => Promise<RawMetric[]> | RawMetric[] } | undefined;
    if (!registry?.getMetricsAsJSON) return {};
    return globalSafeFrom(processWindow, await registry.getMetricsAsJSON(), nowMs);
  } catch { return {}; }
}

async function queueFailedNow(nowMs: number): Promise<number | undefined> {
  try {
    if (!processQueueFailed) {
      const { createQueueFailedReader, redisQueueFailedPort } = await import('./queue.failed');
      processQueueFailed = createQueueFailedReader(redisQueueFailedPort, GLOBAL_WINDOW_SECONDS);
    }
    return await processQueueFailed(nowMs);
  } catch { return undefined; }
}

/**
 * The G export of this process: the HTTP series from the in-process registry (none while metrics are off or the window is still filling) and the
 * node's recent queue failures from Redis (none when Redis does not answer). `{}` when neither is there. Never throws.
 */
export async function exportGlobalSafe(nowMs: number = Date.now()): Promise<Record<string, number>> {
  const [http, queueFailed] = await Promise.all([httpSeries(nowMs), queueFailedNow(nowMs)]);
  return withQueueFailed(http, queueFailed);
}
