/**
 * Release health (phase 18.7): the browser snippet's metrics, folded into one row per release: page views, the share of page views with a
 * JavaScript error, and the 75th percentile of LCP, INP and CLS with Google's rating. Everything is read through `queryMetrics` (so the same
 * caps, the same tenant argument and the same backends as the metric explorer) over the metric names the snippet writes.
 *
 * How the numbers are made, and what they are not:
 *  - The range is cut into steps of at most an hour (the window of PromQL's `*_over_time` is capped at one hour in the query contract).
 *    Counts are summed over the steps, which is exact. A percentile cannot be summed, so a release's p75 is the mean of its per-step p75s
 *    weighted by that step's page views: exact when the range is one step, an approximation beyond that (the answer says which).
 *  - A vital is only reported by page views that had it (no interaction, no INP), so its weight is an upper bound: the rating is a guide,
 *    not an SLO.
 */
import { MetricQuerySchema, type MetricSeries } from './telemetry.types';
import type { QueryDeps } from './telemetry.query.service';
import { assertRange, checkMetricQuery } from './telemetry.query.service';
import { ReleaseHealthInputSchema } from './telemetry.dto';

export const RELEASE_METRICS = {
  views: 'browser_page_views', errorViews: 'browser_page_views_with_errors', errors: 'browser_js_errors',
  lcp: 'browser_web_vitals_lcp', inp: 'browser_web_vitals_inp', cls: 'browser_web_vitals_cls',
} as const;
export const RELEASE_LABEL = 'service.version';
export const ENVIRONMENT_LABEL = 'deployment.environment';

export type Rating = 'good' | 'needs-improvement' | 'poor';
/** Google's thresholds (web.dev/vitals): good up to the first number, poor above the second. LCP and INP in ms, CLS unitless. */
export const THRESHOLDS = { lcp: [2500, 4000], inp: [200, 500], cls: [0.1, 0.25] } as const;

export function rate(vital: keyof typeof THRESHOLDS, value: number | null): Rating | null {
  if (value === null) return null;
  const [good, poor] = THRESHOLDS[vital];
  return value <= good ? 'good' : value <= poor ? 'needs-improvement' : 'poor';
}

export interface ReleaseRow {
  release: string;
  pageViews: number;
  viewsWithErrors: number;
  /** Share of page views with at least one JavaScript error (0 to 1). */
  errorRate: number;
  jsErrors: number;
  lcpP75: number | null;
  inpP75: number | null;
  clsP75: number | null;
  ratings: { lcp: Rating | null; inp: Rating | null; cls: Rating | null };
}

export interface ReleaseHealth {
  releases: ReleaseRow[];
  /** `true` when the range took more than one step, so the percentiles are weighted means of per-step percentiles. */
  approximatePercentiles: boolean;
  stepSeconds: number;
  /** More releases had data than `limit` returned. */
  truncated: boolean;
}

const releaseOf = (s: MetricSeries): string => s.labels[RELEASE_LABEL] ?? '(unknown)';

export function stepFor(rangeMs: number): number {
  return rangeMs <= 3_600_000 ? 300 : 3600;
}

/** Fold the grouped series into rows. Pure: the tests drive it with plain series. */
export function foldReleases(input: Record<keyof typeof RELEASE_METRICS, MetricSeries[]>, limit: number, steps: number): Pick<ReleaseHealth, 'releases' | 'truncated'> {
  const sum = (series: MetricSeries[]) => {
    const m = new Map<string, number>();
    for (const s of series) m.set(releaseOf(s), (m.get(releaseOf(s)) ?? 0) + s.points.reduce((a, [, v]) => a + v, 0));
    return m;
  };
  const viewsByStep = new Map<string, Map<number, number>>();
  for (const s of input.views) {
    const r = releaseOf(s);
    const steps_ = viewsByStep.get(r) ?? new Map<number, number>();
    for (const [t, v] of s.points) steps_.set(t, (steps_.get(t) ?? 0) + v);
    viewsByStep.set(r, steps_);
  }
  const p75 = (series: MetricSeries[]) => {
    const acc = new Map<string, { w: number; v: number }>();
    for (const s of series) {
      const r = releaseOf(s);
      for (const [t, v] of s.points) {
        const w = viewsByStep.get(r)?.get(t) ?? 1;
        const a = acc.get(r) ?? { w: 0, v: 0 };
        a.w += w; a.v += v * w;
        acc.set(r, a);
      }
    }
    return new Map([...acc].map(([r, a]) => [r, a.w > 0 ? a.v / a.w : null] as const));
  };
  const views = sum(input.views), errViews = sum(input.errorViews), errors = sum(input.errors);
  const lcp = p75(input.lcp), inp = p75(input.inp), cls = p75(input.cls);
  const round = (n: number | null | undefined, d: number) => (n === null || n === undefined ? null : Math.round(n * 10 ** d) / 10 ** d);
  const rows: ReleaseRow[] = [...views.entries()].map(([release, pageViews]) => {
    const l = round(lcp.get(release), 0), i = round(inp.get(release), 0), c = round(cls.get(release), 3);
    const ev = Math.min(errViews.get(release) ?? 0, pageViews);
    return {
      release, pageViews, viewsWithErrors: ev, errorRate: pageViews > 0 ? Math.round((ev / pageViews) * 10_000) / 10_000 : 0, jsErrors: errors.get(release) ?? 0,
      lcpP75: l, inpP75: i, clsP75: c, ratings: { lcp: rate('lcp', l), inp: rate('inp', i), cls: rate('cls', c) },
    };
  }).sort((a, b) => b.pageViews - a.pageViews || a.release.localeCompare(b.release));
  void steps;
  return { releases: rows.slice(0, limit), truncated: rows.length > limit };
}

export async function releaseHealth(deps: QueryDeps, tenantId: string, input: unknown): Promise<ReleaseHealth> {
  const q = ReleaseHealthInputSchema.parse(input);
  const caps = await deps.limits().queryCaps(tenantId);
  assertRange(q.range, caps);
  const span = q.range.toMs - q.range.fromMs;
  const step = stepFor(span);
  const filters = q.environment ? [{ field: ENVIRONMENT_LABEL, op: 'eq' as const, value: q.environment }] : [];
  const ask = (metric: string, aggregation: 'total' | 'q75') => {
    const mq = MetricQuerySchema.parse({ range: q.range, stepSeconds: step, windowSeconds: step, metric, aggregation, groupBy: [RELEASE_LABEL], filters });
    checkMetricQuery(mq, caps);
    return deps.backend().queryMetrics(tenantId, mq);
  };
  await deps.limits().admitQuery(tenantId);
  const [views, errorViews, errors, lcp, inp, cls] = await Promise.all([
    ask(RELEASE_METRICS.views, 'total'), ask(RELEASE_METRICS.errorViews, 'total'), ask(RELEASE_METRICS.errors, 'total'),
    ask(RELEASE_METRICS.lcp, 'q75'), ask(RELEASE_METRICS.inp, 'q75'), ask(RELEASE_METRICS.cls, 'q75'),
  ]);
  const steps = Math.ceil(span / 1000 / step);
  return { ...foldReleases({ views, errorViews, errors, lcp, inp, cls }, q.limit, steps), approximatePercentiles: steps > 1, stepSeconds: step };
}
