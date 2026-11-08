/**
 * The Core telemetry store as the METRICS half of the backend port (docs/phases/42-telemetry/04 §4.2, ADR-0009, ED-2, ED-9): a Core install
 * has metrics without Prometheus. Logs and traces stay on their backends (Loki, Tempo); this adapter answers 501 for them.
 *
 *  - Write: every data point becomes one row of kind `observability.series` in the `otel` lane, under the series' entity id (metric + sorted
 *    labels, `otel.series-catalogue.ts`): a gauge or sum is `value`; a histogram is `count`, `sum` and `bucket.<i>` (its bounds are kept in
 *    the catalogue). The tenant is the writer's first argument and never a label (00 §0.4): a tenant key in the point's attributes is
 *    dropped. One writer call per `writeMetrics` (the OTLP ingest already batches a request), one catalogue upsert per wave.
 *  - Read: the catalogue names the series of the metric that match the filters (at most `MAX_SERIES_PER_QUERY`); the store answers all of
 *    them in one pass (`seriesMany`): raw points for a window up to a day, else the finest rollup that fits the step. Points of every series
 *    of a group are POOLED per step and aggregated the way the memory adapter does (the port's reference semantics): sum, avg, min, max,
 *    count; `increase` is the counter increase (a reset counts from zero) and `rate` is it per second of the step; `p50..p99` merge the
 *    bucket counts of the step and interpolate inside the bucket; `q50..q95` need raw observations and are answered for raw windows only
 *    (an explicit 501 beyond a day). Exemplars are not kept (the capability says so).
 *  - Retention per workspace: the class binding of the kind follows the requested metrics retention (`setRetention`; the lifecycle route
 *    stores the setting the kind reads for new tenants). Erasure: the tenant's rows of the lane and its catalogue go (`deleteTenantData`).
 */
import type { SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { TelemetryValue, TelemetryWriteRow, TelemetryWriter } from '@kuraykaraaslan-labs/telemetry/server/telemetry.contract';
import { ClassBindingResolver } from '@kuraykaraaslan-labs/telemetry/server/telemetry.class-binding';
import { getTelemetryQueryService, increases, type AggPoint, type SeriesBucket, type TelemetryPoint, type TelemetryQueryService } from '@kuraykaraaslan-labs/telemetry/server/telemetry.query.service';
import { purgeLane } from '@kuraykaraaslan-labs/telemetry/server/telemetry.tenant-purge';
import { OTEL_LANE } from '@kuraykaraaslan-labs/telemetry/server/telemetry.timeseries';
import { getTelemetryWriter } from '@kuraykaraaslan-labs/telemetry/server/telemetry.writer';
import type { TelemetryBackend } from '../telemetry.backend';
import { TelemetryBackendError, TelemetryUnsupportedError } from '../telemetry.backend';
import type {
  BackendCapabilities, DeleteResult, Exemplar, HistogramValue, LogQueryResult, MetricPoint, MetricQuery, MetricSeries, RetentionPolicy, Signal,
  SpanRecord, TimeRange, TraceSummary, WriteResult,
} from '../telemetry.types';
import { histogramQuantile } from '../telemetry.util';
import { getSeriesCatalogue, MAX_SERIES_PER_QUERY, SERIES_KIND, seriesIdentityOf, type SeriesCatalogue, type SeriesRow, type SeriesSeen } from '../otel.series-catalogue';
import { metricsRetentionClass } from '../telemetry.series-kind';
import { rawQuantile } from './memory.adapter';

export interface TelemetryAdapterDeps {
  writer?: () => TelemetryWriter;
  query?: () => TelemetryQueryService;
  catalogue?: () => SeriesCatalogue;
  /** A tenant transaction (the class switch of `setRetention`). */
  inTenant?: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  classes?: ClassBindingResolver;
  /** Erases the tenant's rows of the lane. */
  purgeLane?: (tenantId: string, lane: string) => Promise<unknown>;
  /** The store answers (health). */
  ping?: () => Promise<void>;
}

const RAW_WINDOW_MS = 24 * 3_600_000;
const HIST_AGG = /^p(50|90|95|99)$/;
const RAW_AGG = /^q(50|75|90|95)$/;
const MAX_BUCKETS = 256;

/** The store rows of one wave of points: one row per (series, time), the histogram's buckets as `bucket.<i>`; the series with the span of their points. Points the store cannot hold are counted. */
export function pointsToRows(points: readonly MetricPoint[]): { rows: TelemetryWriteRow[]; series: SeriesSeen[]; rejected: number } {
  const bySeries = new Map<string, SeriesSeen>();
  const rows = new Map<string, TelemetryWriteRow>();
  let rejected = 0;
  for (const p of points) {
    const values: Record<string, TelemetryValue> = {};
    if (p.kind === 'histogram') {
      const h = p.histogram;
      if (!h || h.counts.length > MAX_BUCKETS || h.counts.length !== h.bounds.length + 1) { rejected += 1; continue; }
      values.count = h.count;
      values.sum = h.sum;
      h.counts.forEach((c, i) => { values[`bucket.${i}`] = c; });
    } else {
      if (typeof p.value !== 'number' || !Number.isFinite(p.value)) { rejected += 1; continue; }
      values.value = p.value;
    }
    if (!Number.isFinite(p.timeMs) || p.timeMs < 0) { rejected += 1; continue; }
    const s = seriesIdentityOf(p);
    const seen = bySeries.get(s.seriesId);
    bySeries.set(s.seriesId, seen ? { ...s, firstMs: Math.min(seen.firstMs, p.timeMs), lastMs: Math.max(seen.lastMs, p.timeMs) } : { ...s, firstMs: p.timeMs, lastMs: p.timeMs });
    const k = `${s.seriesId}|${p.timeMs}`;
    const have = rows.get(k);
    if (have) Object.assign(have.values, values); else rows.set(k, { entityId: s.seriesId, ts: Math.round(p.timeMs), values });
  }
  return { rows: [...rows.values()], series: [...bySeries.values()], rejected };
}

/** The source a step reads: raw inside a day, else the finest rollup not finer than the step that fits the bucket cap. */
export function resolutionForStep(range: TimeRange, stepSeconds: number): Exclude<SeriesBucket, 'auto'> {
  const span = range.toMs - range.fromMs;
  if (span <= RAW_WINDOW_MS) return 'raw';
  if (stepSeconds < 3600 && span / 60_000 <= 10_000) return '1m';
  if (stepSeconds < 86_400 && span / 3_600_000 <= 10_000) return '1h';
  return '1d';
}

interface StepAcc { values: number[]; count: number; sum: number; min: number; max: number; last: number; lastTs: number; increase: number; hist: { counts: number[]; bounds: number[] } | null }
const acc = (): StepAcc => ({ values: [], count: 0, sum: 0, min: Infinity, max: -Infinity, last: NaN, lastTs: -Infinity, increase: 0, hist: null });

function finish(q: MetricQuery, a: StepAcc, raw: boolean): number | null {
  const agg = q.aggregation;
  if (HIST_AGG.test(agg)) {
    if (!a.hist) return null;
    const h: HistogramValue = { count: a.hist.counts.reduce((x, y) => x + y, 0), sum: a.sum, bounds: a.hist.bounds, counts: a.hist.counts };
    return histogramQuantile(Number(agg.slice(1)) / 100, h);
  }
  if (RAW_AGG.test(agg)) return raw && a.values.length ? rawQuantile(a.values, Number(agg.slice(1)) / 100) : null;
  if (!a.count) return null;
  switch (agg) {
    case 'sum': case 'total': return a.sum;
    case 'avg': return a.sum / a.count;
    case 'min': return a.min;
    case 'max': return a.max;
    case 'count': return a.count;
    case 'increase': return a.increase;
    case 'rate': return a.increase / q.stepSeconds;
    default: return null;
  }
}

export class TelemetryMetricsBackend implements TelemetryBackend {
  readonly id = 'telemetry';
  readonly capabilities: BackendCapabilities = {
    signals: { logs: false, traces: false, metrics: true },
    perTenantRetention: true,
    deletion: 'tenant',
    deletableSignals: ['metrics'],
    rawQuery: false,
    exemplars: false,
  };

  private readonly writer: () => TelemetryWriter;
  private readonly query: () => TelemetryQueryService;
  private readonly catalogue: () => SeriesCatalogue;
  private readonly classes: ClassBindingResolver;

  constructor(private readonly d: TelemetryAdapterDeps = {}) {
    this.writer = d.writer ?? getTelemetryWriter;
    this.query = d.query ?? getTelemetryQueryService;
    this.catalogue = d.catalogue ?? getSeriesCatalogue;
    this.classes = d.classes ?? new ClassBindingResolver();
  }

  async writeMetrics(tenantId: string, points: MetricPoint[]): Promise<WriteResult> {
    if (!points.length) return { accepted: 0, rejected: 0 };
    const { rows, series, rejected } = pointsToRows(points);
    if (!rows.length) return { accepted: 0, rejected };
    await this.catalogue().upsert(tenantId, series);
    const r = await this.writer().write(tenantId, SERIES_KIND, rows);
    return { accepted: r.written + r.duplicates, rejected: rejected + r.errors.length };
  }

  async queryMetrics(tenantId: string, q: MetricQuery): Promise<MetricSeries[]> {
    const series = await this.catalogue().find(tenantId, q.metric, q.filters, MAX_SERIES_PER_QUERY);
    if (!series.length) return [];
    const res = resolutionForStep(q.range, q.stepSeconds);
    const raw = res === 'raw';
    if (RAW_AGG.test(q.aggregation) && !raw) throw new TelemetryUnsupportedError(`${q.aggregation} over a window longer than a day (raw observations only)`, this.id);
    const hist = HIST_AGG.test(q.aggregation);
    const maxBuckets = Math.max(0, ...series.map((s) => (s.bounds?.length ?? -1) + 1));
    const keys = hist ? ['count', 'sum', ...Array.from({ length: maxBuckets }, (_, i) => `bucket.${i}`)] : ['value', 'count', 'sum'];
    const many = await this.query().seriesMany(tenantId, SERIES_KIND, series.map((s) => s.seriesId), keys, { from: q.range.fromMs, to: q.range.toMs, bucket: res });
    if (many.truncated) throw new TelemetryBackendError(`${this.id}: the query reads more than the store answers in one pass; narrow the range, the step or the filters`);
    const stepMs = q.stepSeconds * 1000;
    const groups = new Map<string, { labels: Record<string, string>; steps: Map<number, StepAcc> }>();
    const stepOf = (ts: number) => Math.floor((ts - q.range.fromMs) / stepMs);
    for (const s of series) {
      const groupLabels = Object.fromEntries(q.groupBy.filter((g) => s.labels[g] !== undefined).map((g) => [g, s.labels[g]!]));
      const gk = JSON.stringify(groupLabels);
      const g = groups.get(gk) ?? groups.set(gk, { labels: groupLabels, steps: new Map() }).get(gk)!;
      const at = (ts: number) => g.steps.get(stepOf(ts)) ?? g.steps.set(stepOf(ts), acc()).get(stepOf(ts))!;
      if (many.bucket === 'raw') this.poolRaw(s, many.points.get(s.seriesId), at, hist);
      else this.poolAgg(s, many.rows.get(s.seriesId), at, hist);
    }
    const out: MetricSeries[] = [];
    for (const g of groups.values()) {
      const points: Array<[number, number]> = [];
      for (const [idx, a] of [...g.steps.entries()].sort((x, y) => x[0] - y[0])) {
        const v = finish(q, a, raw);
        if (v !== null && Number.isFinite(v)) points.push([q.range.fromMs + idx * stepMs, v]);
      }
      if (points.length) out.push({ metric: q.metric, labels: g.labels, points });
    }
    return out;
  }

  /** Raw points: each message of the series is one observation of the step it falls in. */
  private poolRaw(s: SeriesRow, pts: Record<string, TelemetryPoint[]> | undefined, at: (ts: number) => StepAcc, hist: boolean): void {
    if (!pts) return;
    const byTs = new Map<number, Record<string, number>>();
    for (const [key, list] of Object.entries(pts)) for (const p of list) if (typeof p.value === 'number') (byTs.get(p.ts) ?? byTs.set(p.ts, {}).get(p.ts)!)[key] = p.value;
    let prev: number | null = null;
    for (const ts of [...byTs.keys()].sort((a, b) => a - b)) {
      const v = byTs.get(ts)!;
      const a = at(ts);
      if (hist) {
        if (s.bounds) this.mergeBuckets(a, s.bounds, s.bounds.map((_, i) => v[`bucket.${i}`] ?? 0).concat([v[`bucket.${s.bounds.length}`] ?? 0]), v.sum ?? 0);
        continue;
      }
      // a histogram point read under a plain aggregation is its mean (the memory adapter's rule)
      const value = v.value !== undefined ? v.value : v.count ? (v.sum ?? 0) / v.count : undefined;
      if (value === undefined) continue;
      this.observe(a, value, ts);
      a.increase += prev === null ? 0 : value >= prev ? value - prev : value;
      prev = value;
    }
  }

  /** Rollup buckets: the aggregates of each bucket are folded into the step they fall in. */
  private poolAgg(s: SeriesRow, rows: Record<string, AggPoint[]> | undefined, at: (ts: number) => StepAcc, hist: boolean): void {
    if (!rows) return;
    if (hist) {
      if (!s.bounds) return;
      const byTs = new Map<number, { counts: number[]; sum: number }>();
      const bucketKeys = [...Array.from({ length: s.bounds.length + 1 }, (_, i) => `bucket.${i}`)];
      for (const [i, key] of bucketKeys.entries()) for (const p of rows[key] ?? []) (byTs.get(p.ts) ?? byTs.set(p.ts, { counts: new Array<number>(bucketKeys.length).fill(0), sum: 0 }).get(p.ts)!).counts[i] = p.sum;
      for (const p of rows.sum ?? []) { const b = byTs.get(p.ts); if (b) b.sum = p.sum; }
      for (const [ts, b] of byTs) this.mergeBuckets(at(ts), s.bounds, b.counts, b.sum);
      return;
    }
    const list = rows.value ?? [];
    if (list.length) {
      for (const p of list) {
        const a = at(p.ts);
        a.count += p.count; a.sum += p.sum; a.min = Math.min(a.min, p.min); a.max = Math.max(a.max, p.max);
        if (p.ts >= a.lastTs) { a.last = p.last; a.lastTs = p.ts; }
      }
      for (const inc of increases(list.map((p) => ({ ts: p.ts, min: p.min, last: p.last })))) at(inc.ts).increase += inc.value;
      return;
    }
    // a histogram series under a plain aggregation: its mean per bucket (sum / count), count observations
    const sums = new Map((rows.sum ?? []).map((p) => [p.ts, p.sum]));
    for (const p of rows.count ?? []) {
      const sum = sums.get(p.ts);
      if (sum === undefined || !p.sum) continue;
      const a = at(p.ts);
      const mean = sum / p.sum;
      a.count += 1; a.sum += mean; a.min = Math.min(a.min, mean); a.max = Math.max(a.max, mean);
      if (p.ts >= a.lastTs) { a.last = mean; a.lastTs = p.ts; }
    }
  }

  private observe(a: StepAcc, value: number, ts: number): void {
    a.values.push(value); a.count += 1; a.sum += value; a.min = Math.min(a.min, value); a.max = Math.max(a.max, value);
    if (ts >= a.lastTs) { a.last = value; a.lastTs = ts; }
  }

  private mergeBuckets(a: StepAcc, bounds: number[], counts: number[], sum: number): void {
    if (!a.hist) a.hist = { bounds, counts: new Array<number>(counts.length).fill(0) };
    if (a.hist.counts.length !== counts.length) return; // a series whose bounds changed: its older points are not merged
    counts.forEach((c, i) => { a.hist!.counts[i] += c; });
    a.sum += sum;
    a.count += 1;
  }

  async listMetricNames(tenantId: string, range: TimeRange): Promise<string[]> {
    return this.catalogue().names(tenantId, range);
  }

  async queryExemplars(): Promise<Exemplar[]> { throw new TelemetryUnsupportedError('exemplars', this.id); }

  /** The metrics retention becomes the class of the kind for the tenant (the smallest class that keeps at least the days asked for). */
  async setRetention(tenantId: string, policy: RetentionPolicy): Promise<void> {
    const other = (Object.keys(policy.days) as Signal[]).filter((s) => s !== 'metrics' && policy.days[s] !== undefined);
    if (other.length) throw new TelemetryUnsupportedError(`retention for ${other.join(', ')}`, this.id);
    const days = policy.days.metrics;
    if (days === undefined) return;
    const want = metricsRetentionClass(days);
    const inTenant = this.d.inTenant ?? (async (t, fn) => {
      const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db/server/db.context');
      return withTenantTransactionFor(t, (qr) => fn(qr));
    });
    await inTenant(tenantId, (db) => this.classes.switchTo(db, tenantId, SERIES_KIND, want));
  }

  async deleteTenantData(tenantId: string, signals?: Signal[]): Promise<DeleteResult> {
    if (signals && signals.some((s) => s !== 'metrics')) throw new TelemetryUnsupportedError('deleteTenantData', this.id);
    await (this.d.purgeLane ?? purgeLane)(tenantId, OTEL_LANE);
    const removed = await this.catalogue().purge(tenantId);
    return { state: 'done', removed };
  }

  async health() {
    try {
      await (this.d.ping ?? (async () => {
        const { getDataSource } = await import('@kuraykaraaslan-labs/db');
        await (await getDataSource()).query('SELECT 1');
      }))();
      return { ok: true };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : 'unreachable' };
    }
  }

  async writeLogs(): Promise<WriteResult> { throw new TelemetryUnsupportedError('logs', this.id); }
  async writeSpans(): Promise<WriteResult> { throw new TelemetryUnsupportedError('traces', this.id); }
  async queryLogs(): Promise<LogQueryResult> { throw new TelemetryUnsupportedError('logs', this.id); }
  async tailLogs(): Promise<never> { throw new TelemetryUnsupportedError('logs', this.id); }
  async searchTraces(): Promise<TraceSummary[]> { throw new TelemetryUnsupportedError('traces', this.id); }
  async getTrace(): Promise<SpanRecord[] | null> { throw new TelemetryUnsupportedError('traces', this.id); }
}
