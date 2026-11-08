/**
 * In-process SLIs from the request histogram: latency percentiles (p50/p95/p99), error ratio and request count, over this process's lifetime since boot.
 *
 * This is the per-instance, no-Prometheus read — the same numbers an operator would get from `histogram_quantile` over `/internal/api/metrics`, which is
 * still the source of truth for multi-instance deployments and windows (see `alert-rules.ts` for the recording rules). Percentiles use Prometheus'
 * own interpolation, so the two agree.
 */
import { getMetrics } from './metrics';

export interface BucketCount { le: number; count: number }

/**
 * Prometheus `histogram_quantile`: linear interpolation inside the bucket the rank falls in. `buckets` are CUMULATIVE and sorted by `le`; the last one
 * must be `+Inf`. Returns `null` for an empty histogram; a rank in the `+Inf` bucket returns the highest finite bound (as Prometheus does).
 */
export function histogramQuantile(q: number, buckets: BucketCount[]): number | null {
  if (!(q >= 0 && q <= 1) || buckets.length < 2) return null;
  const total = buckets[buckets.length - 1].count;
  if (total <= 0) return null;
  const rank = q * total;
  const i = buckets.findIndex((b) => b.count >= rank);
  if (i === -1) return null;
  if (!Number.isFinite(buckets[i].le)) return buckets[buckets.length - 2].le;
  const lower = i === 0 ? 0 : buckets[i - 1].le;
  const prevCount = i === 0 ? 0 : buckets[i - 1].count;
  const inBucket = buckets[i].count - prevCount;
  if (inBucket <= 0) return buckets[i].le;
  return lower + (buckets[i].le - lower) * ((rank - prevCount) / inBucket);
}

export interface LatencySli {
  route: string | null;
  requests: number;
  /** Responses with status >= 500 / all responses. */
  errorRatio: number;
  p50Seconds: number | null;
  p95Seconds: number | null;
  p99Seconds: number | null;
}

interface JsonMetricValue { value: number; labels: Record<string, string | number>; metricName?: string }
interface JsonMetric { name: string; values: JsonMetricValue[] }

/** Collapse the histogram's per-(method, route, status, tenant) series into cumulative buckets, optionally for one route; counts 5xx on the way. */
export function aggregateHistogram(metric: JsonMetric | undefined, route?: string): { buckets: BucketCount[]; total: number; errors: number } {
  const perLe = new Map<number, number>();
  let total = 0;
  let errors = 0;
  for (const v of metric?.values ?? []) {
    if (route && v.labels.route !== route) continue;
    if (v.metricName === `${metric!.name}_count`) {
      total += v.value;
      if (Number(v.labels.status) >= 500) errors += v.value;
    } else if (v.metricName === `${metric!.name}_bucket`) {
      const le = v.labels.le === '+Inf' ? Infinity : Number(v.labels.le);
      perLe.set(le, (perLe.get(le) ?? 0) + v.value);
    }
  }
  const buckets = [...perLe.entries()].sort((a, b) => a[0] - b[0]).map(([le, count]) => ({ le, count }));
  return { buckets, total, errors };
}

/** SLI snapshot for all routes, or one. `null` when metrics are disabled (nothing is being recorded). */
export async function computeLatencySli(route?: string): Promise<LatencySli | null> {
  const m = getMetrics();
  if (!m) return null;
  const reg = m.registry as unknown as { getMetricsAsJSON?: () => Promise<JsonMetric[]> };
  if (typeof reg.getMetricsAsJSON !== 'function') return null;
  const metric = (await reg.getMetricsAsJSON()).find((x) => x.name === 'http_request_duration_seconds');
  const { buckets, total, errors } = aggregateHistogram(metric, route);
  return {
    route: route ?? null,
    requests: total,
    errorRatio: total > 0 ? errors / total : 0,
    p50Seconds: histogramQuantile(0.5, buckets),
    p95Seconds: histogramQuantile(0.95, buckets),
    p99Seconds: histogramQuantile(0.99, buckets),
  };
}
