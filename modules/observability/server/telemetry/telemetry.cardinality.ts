/**
 * Cardinality caps at ingest (observability phase 16.5 / 17): what a tenant's SENDER can multiply without limit, bounded where it enters.
 *
 *  - Metrics: every distinct series (metric name + attributes + service) a tenant introduces is remembered for the UTC day, in a Redis set per tenant and
 *    one per metric name. A data point whose series would exceed the tenant's active-series cap, or the per-metric cap, is DROPPED (counted, never stored).
 *    A series already known is always admitted: a cap stops growth, it never starves what was already there.
 *  - Logs: `service.name` becomes a stream label in the store, so a sender that invents service names invents streams. Beyond the day's stream cap,
 *    further names are folded into `_overflow` (the lines are kept, the label set is not), counted.
 *
 * Both are SAFETY CEILINGS that apply without a plan (a plan can set its own number through the limit keys): a hostile key holder must be bounded
 * even on a deployment with no plans. Every Redis failure fails OPEN (data is not dropped because the counter is down).
 */
import { createHash } from 'node:crypto';
import { OBSERVABILITY_LIMIT_KEYS as K } from '../observability.limit-keys';
import { limitOf } from '../observability.limits';
import { redisCall } from '../observability.redis-guard';
import type { LogRecord, MetricPoint } from './telemetry.types';

export const DEFAULT_ACTIVE_SERIES = 100_000;
export const DEFAULT_SERIES_PER_METRIC = 10_000;
export const DEFAULT_LOG_STREAMS = 500;
export const OVERFLOW_SERVICE = '_overflow';

/** 0 = admitted, 1 = tenant cap, 2 = metric cap. */
export type SeriesVerdict = 0 | 1 | 2;

export interface SeriesStore {
  /** Admit or refuse each id (already unique), remembering the admitted ones for `day`. Never throws for a store problem: it fails open. */
  admit(tenantId: string, day: string, metric: string, ids: string[], caps: { tenant: number; metric: number }): Promise<SeriesVerdict[]>;
  /** Same for log streams: 0 = admitted, 1 = cap. */
  admitStreams(tenantId: string, day: string, names: string[], cap: number): Promise<SeriesVerdict[]>;
  /** Count a drop for visibility (`reason` is a short token). */
  countDrop(tenantId: string, day: string, reason: string, n: number): Promise<void>;
}

const LUA = `
local capT, capM = tonumber(ARGV[1]), tonumber(ARGV[2])
local out = {}
for i = 3, #ARGV do
  local id = ARGV[i]
  if redis.call('SISMEMBER', KEYS[2], id) == 1 then out[#out+1] = 0
  elseif redis.call('SCARD', KEYS[1]) >= capT then out[#out+1] = 1
  elseif redis.call('SCARD', KEYS[2]) >= capM then out[#out+1] = 2
  else
    redis.call('SADD', KEYS[1], id); redis.call('SADD', KEYS[2], id); out[#out+1] = 0
  end
end
redis.call('EXPIRE', KEYS[1], 172800); redis.call('EXPIRE', KEYS[2], 172800)
return out
`;

const LUA_STREAMS = `
local cap = tonumber(ARGV[1])
local out = {}
for i = 2, #ARGV do
  local id = ARGV[i]
  if redis.call('SISMEMBER', KEYS[1], id) == 1 then out[#out+1] = 0
  elseif redis.call('SCARD', KEYS[1]) >= cap then out[#out+1] = 1
  else redis.call('SADD', KEYS[1], id); out[#out+1] = 0 end
end
redis.call('EXPIRE', KEYS[1], 172800)
return out
`;

export const redisSeriesStore: SeriesStore = {
  async admit(tenantId, day, metric, ids, caps) {
    if (ids.length === 0) return [];
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis');
      const res = (await redisCall(() => redis.eval(LUA, 2, `obs:series:${tenantId}:${day}`, `obs:series_m:${tenantId}:${day}:${hash(metric)}`, String(caps.tenant), String(caps.metric), ...ids))) as number[];
      return res.map((v) => (v === 1 ? 1 : v === 2 ? 2 : 0));
    } catch { return ids.map(() => 0 as SeriesVerdict); }
  },
  async admitStreams(tenantId, day, names, cap) {
    if (names.length === 0) return [];
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis');
      const res = (await redisCall(() => redis.eval(LUA_STREAMS, 1, `obs:streams:${tenantId}:${day}`, String(cap), ...names.map(hash)))) as number[];
      return res.map((v) => (v === 1 ? 1 : 0));
    } catch { return names.map(() => 0 as SeriesVerdict); }
  },
  async countDrop(tenantId, day, reason, n) {
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis');
      const key = `obs:telemetry_dropped:${tenantId}:${day}`;
      await redisCall(async () => { await redis.hincrby(key, reason, n); await redis.expire(key, 8 * 86_400); });
    } catch { /* visibility is best-effort */ }
  },
};

/** An in-memory store with the same semantics, for tests and for a process without Redis. */
export function memorySeriesStore(): SeriesStore & { drops: Map<string, number> } {
  const tenantSets = new Map<string, Set<string>>();
  const metricSets = new Map<string, Set<string>>();
  const streamSets = new Map<string, Set<string>>();
  const drops = new Map<string, number>();
  const set = (m: Map<string, Set<string>>, k: string) => { let s = m.get(k); if (!s) m.set(k, (s = new Set())); return s; };
  return {
    drops,
    async admit(tenantId, day, metric, ids, caps) {
      const t = set(tenantSets, `${tenantId}:${day}`); const m = set(metricSets, `${tenantId}:${day}:${metric}`);
      return ids.map((id): SeriesVerdict => {
        if (m.has(id)) return 0;
        if (t.size >= caps.tenant) return 1;
        if (m.size >= caps.metric) return 2;
        t.add(id); m.add(id); return 0;
      });
    },
    async admitStreams(tenantId, day, names, cap) {
      const s = set(streamSets, `${tenantId}:${day}`);
      return names.map((n): SeriesVerdict => { if (s.has(n)) return 0; if (s.size >= cap) return 1; s.add(n); return 0; });
    },
    async countDrop(tenantId, day, reason, n) { const k = `${tenantId}:${day}:${reason}`; drops.set(k, (drops.get(k) ?? 0) + n); },
  };
}

let store: SeriesStore = redisSeriesStore;
/** Test seam. */
export function setSeriesStore(s?: SeriesStore): void { store = s ?? redisSeriesStore; }

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/** The identity of a series: name, service and attributes, order-insensitive. */
export function seriesId(p: Pick<MetricPoint, 'name' | 'attributes' | 'resource'>): string {
  const attrs = Object.keys(p.attributes).sort().map((k) => `${k}=${String(p.attributes[k])}`).join('\u0001');
  return hash(`${p.name}\u0000${String(p.resource['service.name'] ?? '')}\u0000${attrs}`);
}

export interface CardinalityOutcome<T> { kept: T[]; dropped: number; reasons: Record<string, number> }

async function caps(tenantId: string): Promise<{ tenant: number; metric: number; streams: number }> {
  const [a, m, s] = await Promise.all([limitOf(tenantId, K.ACTIVE_SERIES), limitOf(tenantId, K.SERIES_PER_METRIC), limitOf(tenantId, K.LOG_STREAMS)]);
  // A plan's number wins in both directions; with none declared the safety ceiling applies.
  const pick = (planned: number, ceiling: number) => (Number.isFinite(planned) ? Math.max(0, Math.floor(planned)) : ceiling);
  return { tenant: pick(a, DEFAULT_ACTIVE_SERIES), metric: pick(m, DEFAULT_SERIES_PER_METRIC), streams: pick(s, DEFAULT_LOG_STREAMS) };
}

/** Metric points whose series fits the caps; the rest are dropped and counted. */
export async function capMetricSeries(tenantId: string, points: MetricPoint[], now: Date = new Date()): Promise<CardinalityOutcome<MetricPoint>> {
  if (points.length === 0) return { kept: points, dropped: 0, reasons: {} };
  const c = await caps(tenantId);
  const day = dayKey(now);
  const byMetric = new Map<string, Map<string, MetricPoint[]>>();
  for (const p of points) {
    const id = seriesId(p);
    let m = byMetric.get(p.name); if (!m) byMetric.set(p.name, (m = new Map()));
    const l = m.get(id); if (l) l.push(p); else m.set(id, [p]);
  }
  const kept: MetricPoint[] = [];
  const reasons: Record<string, number> = {};
  for (const [name, series] of byMetric) {
    const ids = [...series.keys()];
    const verdicts = await store.admit(tenantId, day, name, ids, { tenant: c.tenant, metric: c.metric });
    ids.forEach((id, i) => {
      const pts = series.get(id)!;
      if (verdicts[i] === 0) kept.push(...pts);
      else { const r = verdicts[i] === 1 ? 'series_tenant_cap' : 'series_metric_cap'; reasons[r] = (reasons[r] ?? 0) + pts.length; }
    });
  }
  const dropped = Object.values(reasons).reduce((a, b) => a + b, 0);
  for (const [r, n] of Object.entries(reasons)) await store.countDrop(tenantId, day, r, n);
  return { kept, dropped, reasons };
}

/** Log records with `service.name` folded into `_overflow` beyond the day's stream cap. The lines are all kept. */
export async function capLogStreams(tenantId: string, records: LogRecord[], now: Date = new Date()): Promise<{ records: LogRecord[]; folded: number }> {
  if (records.length === 0) return { records, folded: 0 };
  const c = await caps(tenantId);
  const day = dayKey(now);
  const names = [...new Set(records.map((r) => String(r.resource['service.name'] ?? 'unknown_service')))];
  const verdicts = await store.admitStreams(tenantId, day, names, c.streams);
  const over = new Set(names.filter((_, i) => verdicts[i] !== 0));
  if (over.size === 0) return { records, folded: 0 };
  let folded = 0;
  const out = records.map((r) => {
    if (!over.has(String(r.resource['service.name'] ?? 'unknown_service'))) return r;
    folded += 1;
    return { ...r, resource: { ...r.resource, 'service.name': OVERFLOW_SERVICE } };
  });
  await store.countDrop(tenantId, day, 'stream_overflow', folded);
  return { records: out, folded };
}

/** What the operator view shows: today's drops by reason. */
export async function droppedToday(tenantId: string, now: Date = new Date()): Promise<Record<string, number>> {
  try {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis');
    const raw = await redisCall(() => redis.hgetall(`obs:telemetry_dropped:${tenantId}:${dayKey(now)}`));
    return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Number(v)]));
  } catch { return {}; }
}
