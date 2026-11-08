import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import { DEFAULT_RETENTION_CLASS, type RetentionClass, type TelemetryValue } from './telemetry.contract';
import { DAY_MS, dayTableOf, hourTableOf, KEYS_TABLE, latestTableOf, minuteRetentionDays, minuteTableOf, oldestRawTs, rawTableOf } from './telemetry.classes';
import { ClassBindingResolver } from './telemetry.class-binding';
import { cachedKindId, ensureTelemetryKindsLoaded, laneOf, resolveKindId, telemetryKindOf, type TelemetryEntityKind } from './telemetry.kinds';
import { MINUTE_MS } from './telemetry.minute-window';

/**
 * The read service (docs/phases/42-telemetry/02 §2.1): the latest values of an entity of a kind, its keys, the raw points of one
 * key over a short window, and `series`: one or more keys over any window, read from the source the window calls for (raw rows up
 * to a day, then the 1-minute aggregates, then the hour and day rollups; OD-32: a range over 24 h never reads raw), with an
 * aggregate per bucket (avg, min, max, last, sum, count, or `increase` for counters). Every query names the tenant, the kind and
 * the entity, adds `kindId = $k` (an id of another kind returns nothing, ED-10) and runs in a tenant transaction (RLS); the class
 * tables and rollups are read through their access views; an unknown kind answers nothing.
 *
 * The kind's `canRead` is the caller's duty: the HTTP routes and the dashboard source apply it before answering a user; a server-side
 * caller already acts for its module.
 *
 * Two messages at one `ts` that both carry a key are both stored (per-message idempotency); a raw read keeps one point per `ts`,
 * the row with the higher `msgHash` (a stable choice: equal-time messages have no order).
 */
export const DEFAULT_RANGE_LIMIT = 10_000;
/** The most points one series answers (per key). */
export const MAX_SERIES_POINTS = 10_000;
/** A window is refused when it would hold more buckets than this at the chosen resolution. */
export const MAX_SERIES_BUCKETS = 10_000;
/** The most entities one `seriesMany` read names. */
export const MAX_MANY_ENTITIES = 500;
/** The most raw messages one `messages` or raw `seriesMany` read returns (over every entity). */
export const MAX_MESSAGE_ROWS = 50_000;
/** The most aggregate rows one `seriesMany` read returns (over every entity and key). */
export const MAX_AGG_ROWS = 200_000;
const HOUR_MS = 3_600_000;

export type SeriesBucket = 'auto' | 'raw' | '1m' | '1h' | '1d';
export type SeriesAgg = 'avg' | 'min' | 'max' | 'last' | 'sum' | 'count' | 'increase';

export interface TelemetryPoint {
  ts: number;
  value: TelemetryValue;
}

/** One stored message: every key it carried, at its time. */
export interface TelemetryMessage {
  ts: number;
  values: Record<string, TelemetryValue>;
}

/** One bucket of the 1-minute, hour or day source, every aggregate at once (the caller picks or combines). */
export interface AggPoint {
  ts: number;
  sum: number;
  count: number;
  min: number;
  max: number;
  last: number;
}

export interface SeriesManyOptions {
  from: number;
  to: number;
  /** `auto` (default): as `series`. */
  bucket?: SeriesBucket;
}

export type SeriesManyResult =
  | { bucket: 'raw'; points: Map<string, Record<string, TelemetryPoint[]>>; truncated: boolean }
  | { bucket: '1m' | '1h' | '1d'; rows: Map<string, Record<string, AggPoint[]>>; truncated: boolean };

export interface SeriesOptions {
  from: number;
  to: number;
  /** `auto` (default): raw up to 24 h, then the finest rollup whose bucket count fits `MAX_SERIES_BUCKETS`. */
  bucket?: SeriesBucket;
  /** Default `avg`; ignored for `raw` (the stored values). */
  agg?: SeriesAgg;
  /** Points per key, at most `MAX_SERIES_POINTS`. */
  limit?: number;
}

export class TelemetryQueryError extends Error {
  constructor(message: string, readonly code: 'bad_range' | 'range_too_large' | 'bad_bucket' | 'too_many_entities') {
    super(message);
    this.name = 'TelemetryQueryError';
  }
}

export interface TelemetryQueryDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  classes?: ClassBindingResolver;
  now?: () => number;
}

export interface TelemetryQueryService {
  /** The latest value of each key of the entity (only `keys` when given). */
  latest(tenantId: string, kind: string, entityId: string, keys?: readonly string[]): Promise<Record<string, { ts: number; value: TelemetryValue }>>;
  /** The latest values of many entities of one kind in one query (at most 1 000 ids; only `keys` when given), by entity id. */
  latestMany(tenantId: string, kind: string, entityIds: readonly string[], keys?: readonly string[]): Promise<Map<string, Record<string, { ts: number; value: TelemetryValue }>>>;
  /** The keys the entity has a latest value for. */
  keys(tenantId: string, kind: string, entityId: string): Promise<string[]>;
  /** The raw points of `key` in `[from, to)`, oldest first, at most `limit` (a short window; `series` picks the source by range). */
  range(tenantId: string, kind: string, entityId: string, key: string, o: { from: number; to: number; limit?: number }): Promise<TelemetryPoint[]>;
  /** One series per key over `[from, to)`, from the source the window calls for, aggregated per bucket. */
  series(tenantId: string, kind: string, entityId: string, keys: readonly string[], o: SeriesOptions): Promise<Record<string, TelemetryPoint[]>>;
  /**
   * The raw messages of one entity in `[from, to)` with every key they carry, oldest first, one per `ts` (the row with the higher
   * `msgHash`), at most `limit` (`MAX_MESSAGE_ROWS`); the raw window only. For a reader that wants whole records (a probe sample,
   * a visit's readings), not one key's series.
   */
  messages(tenantId: string, kind: string, entityId: string, o: { from: number; to: number; limit?: number }): Promise<TelemetryMessage[]>;
  /**
   * The same keys of many entities (at most `MAX_MANY_ENTITIES`) over a window in one pass: the raw points when the window reads
   * raw, else every aggregate of each bucket at the resolution, by entity and key. `truncated` says a cap cut the answer.
   */
  seriesMany(tenantId: string, kind: string, entityIds: readonly string[], keys: readonly string[], o: SeriesManyOptions): Promise<SeriesManyResult>;
  /** The resolution `series` would use for a window with `bucket: 'auto'`. */
  resolutionFor(from: number, to: number): Exclude<SeriesBucket, 'auto'>;
}

/** Which source a window reads by default: raw up to a day, else the finest rollup whose bucket count fits the cap. */
export function resolutionFor(from: number, to: number): Exclude<SeriesBucket, 'auto'> {
  const span = to - from;
  if (span <= 24 * HOUR_MS) return 'raw';
  if (span / MINUTE_MS <= MAX_SERIES_BUCKETS) return '1m';
  if (span / HOUR_MS <= MAX_SERIES_BUCKETS) return '1h';
  return '1d';
}

interface AggRow { keyId: number; ts: Date | string; sum: number | string; count: number | string; min: number | string; max: number | string; last: number | string }
interface AggRowMany extends AggRow { entityId: string }
interface RawMsgRow { entityId: string; ts: Date | string; numKeyIds: number[] | null; numVals: number[] | null; other: Record<string, unknown> | null }
interface RawMessage extends TelemetryMessage { entityId: string }

const bucketMsOf = (res: Exclude<SeriesBucket, 'auto'>): number | null => (res === '1m' ? MINUTE_MS : res === '1h' ? HOUR_MS : res === '1d' ? DAY_MS : null);

function assertWindow(from: number, to: number, res: Exclude<SeriesBucket, 'auto'>): void {
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new TelemetryQueryError('the window is empty or not a range', 'bad_range');
  const bucketMs = bucketMsOf(res);
  if (bucketMs !== null && (to - from) / bucketMs > MAX_SERIES_BUCKETS) {
    throw new TelemetryQueryError(`the window holds more than ${MAX_SERIES_BUCKETS} buckets at ${res}`, 'range_too_large');
  }
}

/** The value of one aggregate row under `agg`; `increase` needs the previous bucket's `last`. */
function valueOf(agg: Exclude<SeriesAgg, 'increase'>, r: AggRow): number {
  switch (agg) {
    case 'avg': return Number(r.count) ? Number(r.sum) / Number(r.count) : 0;
    case 'min': return Number(r.min);
    case 'max': return Number(r.max);
    case 'last': return Number(r.last);
    case 'sum': return Number(r.sum);
    case 'count': return Number(r.count);
  }
}

/**
 * Counter increase per bucket from the aggregates: `last - previous last`; a reset (the value went down) counts from zero
 * (`last`); the first bucket of the window counts what rose inside it (`last - min`).
 */
export function increases(rows: ReadonlyArray<{ ts: number; min: number; last: number }>): Array<{ ts: number; value: number }> {
  const out: Array<{ ts: number; value: number }> = [];
  let prev: number | null = null;
  for (const r of rows) {
    const value = prev === null ? Math.max(0, r.last - r.min) : r.last >= prev ? r.last - prev : r.last;
    out.push({ ts: r.ts, value });
    prev = r.last;
  }
  return out;
}

export function createTelemetryQueryService(d: TelemetryQueryDeps): TelemetryQueryService {
  const classes = d.classes ?? new ClassBindingResolver();
  const now = d.now ?? Date.now;

  const kindOf = async (kind: string): Promise<TelemetryEntityKind | undefined> => {
    let k = telemetryKindOf(kind);
    if (!k) {
      await ensureTelemetryKindsLoaded();
      k = telemetryKindOf(kind);
    }
    return k;
  };
  const kindIdOf = async (db: SqlRunner, kind: string): Promise<number> => cachedKindId(kind) ?? resolveKindId(db, kind);
  const keyIdsOf = async (db: SqlRunner, tenantId: string, keys: readonly string[]): Promise<Map<string, number>> => {
    const rows = rowsOf<{ keyId: number; key: string }>(await db.query(`SELECT "keyId", "key" FROM "${KEYS_TABLE}" WHERE "tenantId" = $1 AND "key" = ANY($2::text[])`, [tenantId, [...keys]]));
    return new Map(rows.map((r) => [r.key, Number(r.keyId)]));
  };
  /** The classes the tenant ever wrote the kind into (a record's class is the one of its write, not of its ts). */
  const classesUsed = async (db: SqlRunner, tenantId: string, kind: string): Promise<RetentionClass[]> => {
    const history = await classes.history(db, tenantId, kind);
    return history.length ? [...new Set(history.map((h) => h.d))] : [DEFAULT_RETENTION_CLASS];
  };

  async function rawPoints(db: SqlRunner, tenantId: string, kind: string, lane: string, kindId: number, entityId: string, keyId: number, key: string, from: number, to: number, limit: number): Promise<TelemetryPoint[]> {
    const byTs = new Map<number, TelemetryValue>();
    for (const c of await classesUsed(db, tenantId, kind)) {
      const w = { from: Math.max(from, oldestRawTs(c, now())), to };
      if (w.from >= w.to) continue;
      const rel = await d.accessRel(db, rawTableOf(c, lane));
      const rows = rowsOf<{ ts: Date | string; v: unknown }>(await db.query(
        `SELECT DISTINCT ON (r."ts") r."ts",
                CASE WHEN array_position(r."numKeyIds", $3::int4) IS NOT NULL
                     THEN to_jsonb(r."numVals"[array_position(r."numKeyIds", $3::int4)])
                     ELSE r."other" -> $4::text END AS v
           FROM ${rel} r
          WHERE r."tenantId" = $1 AND r."kindId" = $8 AND r."entityId" = $2 AND r."ts" >= $5 AND r."ts" < $6
            AND ($3::int4 = ANY(r."numKeyIds") OR jsonb_exists(r."other", $4::text))
          ORDER BY r."ts", r."msgHash" DESC
          LIMIT $7`,
        [tenantId, entityId, keyId, key, new Date(w.from), new Date(w.to), limit, kindId],
      ));
      for (const r of rows) {
        const ts = new Date(r.ts).getTime();
        if (!byTs.has(ts)) byTs.set(ts, r.v as TelemetryValue);
      }
    }
    return [...byTs.entries()].sort((a, b) => a[0] - b[0]).slice(0, limit).map(([ts, value]) => ({ ts, value }));
  }

  /** Whole raw messages of many entities over a window, one per (entity, ts), with the key names resolved; `limit + 1` rows are asked to tell a cut. */
  async function rawMessages(db: SqlRunner, tenantId: string, kind: string, lane: string, kindId: number, entityIds: readonly string[], from: number, to: number, limit: number): Promise<{ rows: RawMessage[]; truncated: boolean }> {
    const seen = new Set<string>();
    const raw: Array<{ entityId: string; ts: number; numKeyIds: number[]; numVals: number[]; other: Record<string, unknown> | null }> = [];
    let truncated = false;
    for (const c of await classesUsed(db, tenantId, kind)) {
      const w = { from: Math.max(from, oldestRawTs(c, now())), to };
      if (w.from >= w.to) continue;
      const rel = await d.accessRel(db, rawTableOf(c, lane));
      const rows = rowsOf<RawMsgRow>(await db.query(
        `SELECT r."entityId", r."ts", r."numKeyIds", r."numVals", r."other"
           FROM ${rel} r
          WHERE r."tenantId" = $1 AND r."kindId" = $2 AND r."entityId" = ANY($3::uuid[]) AND r."ts" >= $4 AND r."ts" < $5
          ORDER BY r."entityId", r."ts", r."msgHash" DESC
          LIMIT $6`,
        [tenantId, kindId, [...entityIds], new Date(w.from), new Date(w.to), limit + 1],
      ));
      if (rows.length > limit) {
        truncated = true;
        rows.length = limit;
      }
      for (const r of rows) {
        const ts = new Date(r.ts).getTime();
        const entityId = String(r.entityId).toLowerCase();
        const k = `${entityId}|${ts}`;
        if (seen.has(k)) continue;
        seen.add(k);
        raw.push({ entityId, ts, numKeyIds: r.numKeyIds ?? [], numVals: r.numVals ?? [], other: r.other ?? null });
      }
    }
    const names = new Map<number, string>();
    const ids = [...new Set(raw.flatMap((r) => r.numKeyIds.map(Number)))];
    if (ids.length) {
      for (const r of rowsOf<{ keyId: number; key: string }>(await db.query(`SELECT "keyId", "key" FROM "${KEYS_TABLE}" WHERE "tenantId" = $1 AND "keyId" = ANY($2::int4[])`, [tenantId, ids]))) names.set(Number(r.keyId), r.key);
    }
    const out: RawMessage[] = raw.map((r) => {
      const values: Record<string, TelemetryValue> = {};
      r.numKeyIds.forEach((id, i) => {
        const name = names.get(Number(id));
        if (name !== undefined) values[name] = Number(r.numVals[i]);
      });
      if (r.other) for (const [key, v] of Object.entries(r.other)) values[key] = v as TelemetryValue;
      return { entityId: r.entityId, ts: r.ts, values };
    });
    out.sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : a.ts - b.ts));
    if (out.length > limit) {
      truncated = true;
      out.length = limit;
    }
    return { rows: out, truncated };
  }

  /** The aggregate rows of many entities and keys at one resolution, deduplicated over the classes used; `limit + 1` rows per class tell a cut. */
  async function aggRowsMany(db: SqlRunner, tenantId: string, kind: string, lane: string, kindId: number, entityIds: readonly string[], keyIds: readonly number[], res: '1m' | '1h' | '1d', from: number, to: number, limit: number): Promise<{ rows: AggRowMany[]; truncated: boolean }> {
    const out = new Map<string, AggRowMany>();
    let truncated = false;
    for (const c of await classesUsed(db, tenantId, kind)) {
      const keep = res === '1m' ? minuteRetentionDays(c) : c;
      const w = { from: Math.max(from, now() - keep * DAY_MS), to };
      if (w.from >= w.to) continue;
      const table = res === '1m' ? minuteTableOf(c, lane) : res === '1h' ? hourTableOf(c, lane) : dayTableOf(c, lane);
      const rel = await d.accessRel(db, table);
      const rows = res === '1m'
        ? rowsOf<AggRowMany>(await db.query(
          `SELECT "entityId", "keyId", "ts", "sum", "count", "min", "max", "last" FROM ${rel}
            WHERE "tenantId" = $1 AND "kindId" = $2 AND "entityId" = ANY($3::uuid[]) AND "keyId" = ANY($4::int4[]) AND "ts" >= $5 AND "ts" < $6
            ORDER BY "entityId", "keyId", "ts" LIMIT $7`,
          [tenantId, kindId, [...entityIds], [...keyIds], new Date(w.from), new Date(w.to), limit + 1],
        ))
        : rowsOf<AggRowMany>(await db.query(
          `SELECT "entityId", "keyId", "bucket" AS "ts", "sum_sum" AS "sum", "count_sum" AS "count", "min_min" AS "min", "max_max" AS "max", "last_last" AS "last" FROM ${rel}
            WHERE "tenantId" = $1 AND "entityId" = ANY($2::uuid[]) AND "keyId" = ANY($3::int4[]) AND "bucket" >= $4 AND "bucket" < $5
            ORDER BY "entityId", "keyId", "bucket" LIMIT $6`,
          [tenantId, [...entityIds], [...keyIds], new Date(w.from), new Date(w.to), limit + 1],
        ));
      if (rows.length > limit) {
        truncated = true;
        rows.length = limit;
      }
      for (const r of rows) {
        const entityId = String(r.entityId).toLowerCase();
        const k = `${entityId}|${r.keyId}|${new Date(r.ts).getTime()}`;
        if (!out.has(k)) out.set(k, { ...r, entityId });
      }
    }
    return { rows: [...out.values()], truncated };
  }

  async function aggRows(db: SqlRunner, tenantId: string, kind: string, lane: string, kindId: number, entityId: string, keyIds: readonly number[], res: '1m' | '1h' | '1d', from: number, to: number): Promise<AggRow[]> {
    const out = new Map<string, AggRow>();
    for (const c of await classesUsed(db, tenantId, kind)) {
      const keep = res === '1m' ? minuteRetentionDays(c) : c;
      const w = { from: Math.max(from, now() - keep * DAY_MS), to };
      if (w.from >= w.to) continue;
      const table = res === '1m' ? minuteTableOf(c, lane) : res === '1h' ? hourTableOf(c, lane) : dayTableOf(c, lane);
      const rel = await d.accessRel(db, table);
      const rows = res === '1m'
        ? rowsOf<AggRow>(await db.query(
          `SELECT "keyId", "ts", "sum", "count", "min", "max", "last" FROM ${rel}
            WHERE "tenantId" = $1 AND "kindId" = $2 AND "entityId" = $3 AND "keyId" = ANY($4::int4[]) AND "ts" >= $5 AND "ts" < $6
            ORDER BY "ts"`,
          [tenantId, kindId, entityId, [...keyIds], new Date(w.from), new Date(w.to)],
        ))
        : rowsOf<AggRow>(await db.query(
          `SELECT "keyId", "bucket" AS "ts", "sum_sum" AS "sum", "count_sum" AS "count", "min_min" AS "min", "max_max" AS "max", "last_last" AS "last" FROM ${rel}
            WHERE "tenantId" = $1 AND "entityId" = $2 AND "keyId" = ANY($3::int4[]) AND "bucket" >= $4 AND "bucket" < $5
            ORDER BY "bucket"`,
          [tenantId, entityId, [...keyIds], new Date(w.from), new Date(w.to)],
        ));
      for (const r of rows) {
        const k = `${r.keyId}|${new Date(r.ts).getTime()}`;
        if (!out.has(k)) out.set(k, r);
      }
    }
    return [...out.values()];
  }

  return {
    resolutionFor,

    async latest(tenantId, kind, entityId, keys) {
      const k = await kindOf(kind);
      if (!k) return {};
      const latest = latestTableOf(laneOf(k));
      const rows = await d.inTenant(tenantId, async (db) => {
        const kindId = await kindIdOf(db, kind);
        return rowsOf<{ key: string; ts: Date | string; numVal: number | null; other: unknown }>(await db.query(
          `SELECT k."key", l."ts", l."numVal", l."other"
             FROM "${latest}" l JOIN "${KEYS_TABLE}" k ON k."tenantId" = l."tenantId" AND k."keyId" = l."keyId"
            WHERE l."tenantId" = $1 AND l."kindId" = $2 AND l."entityId" = $3${keys ? ` AND k."key" = ANY($4::text[])` : ''}`,
          keys ? [tenantId, kindId, entityId, [...keys]] : [tenantId, kindId, entityId],
        ));
      });
      const out: Record<string, { ts: number; value: TelemetryValue }> = {};
      for (const r of rows) out[r.key] = { ts: new Date(r.ts).getTime(), value: (r.numVal ?? r.other) as TelemetryValue };
      return out;
    },

    async latestMany(tenantId, kind, entityIds, keys) {
      const out = new Map<string, Record<string, { ts: number; value: TelemetryValue }>>();
      const ids = [...new Set(entityIds.map((e) => e.toLowerCase()))].slice(0, 1_000);
      const k = await kindOf(kind);
      if (!k || !ids.length) return out;
      const latest = latestTableOf(laneOf(k));
      const rows = await d.inTenant(tenantId, async (db) => {
        const kindId = await kindIdOf(db, kind);
        return rowsOf<{ entityId: string; key: string; ts: Date | string; numVal: number | null; other: unknown }>(await db.query(
          `SELECT l."entityId", k."key", l."ts", l."numVal", l."other"
             FROM "${latest}" l JOIN "${KEYS_TABLE}" k ON k."tenantId" = l."tenantId" AND k."keyId" = l."keyId"
            WHERE l."tenantId" = $1 AND l."kindId" = $2 AND l."entityId" = ANY($3::uuid[])${keys ? ` AND k."key" = ANY($4::text[])` : ''}`,
          keys ? [tenantId, kindId, ids, [...keys]] : [tenantId, kindId, ids],
        ));
      });
      for (const r of rows) {
        const id = String(r.entityId).toLowerCase();
        const rec = out.get(id) ?? out.set(id, {}).get(id)!;
        rec[r.key] = { ts: new Date(r.ts).getTime(), value: (r.numVal ?? r.other) as TelemetryValue };
      }
      return out;
    },

    async keys(tenantId, kind, entityId) {
      return Object.keys(await this.latest(tenantId, kind, entityId)).sort();
    },

    async range(tenantId, kind, entityId, key, o) {
      const k = await kindOf(kind);
      if (!k) return [];
      const lane = laneOf(k);
      const limit = Math.max(1, Math.min(o.limit ?? DEFAULT_RANGE_LIMIT, DEFAULT_RANGE_LIMIT));
      return d.inTenant(tenantId, async (db) => {
        const kindId = await kindIdOf(db, kind);
        const keyId = (await keyIdsOf(db, tenantId, [key])).get(key);
        if (keyId === undefined) return [];
        return rawPoints(db, tenantId, kind, lane, kindId, entityId, keyId, key, o.from, o.to, limit);
      });
    },

    async messages(tenantId, kind, entityId, o) {
      assertWindow(o.from, o.to, 'raw');
      const k = await kindOf(kind);
      if (!k) return [];
      const lane = laneOf(k);
      const limit = Math.max(1, Math.min(o.limit ?? DEFAULT_RANGE_LIMIT, MAX_MESSAGE_ROWS));
      return d.inTenant(tenantId, async (db) => {
        const kindId = await kindIdOf(db, kind);
        const r = await rawMessages(db, tenantId, kind, lane, kindId, [entityId.toLowerCase()], o.from, o.to, limit);
        return r.rows.map(({ ts, values }) => ({ ts, values }));
      });
    },

    async seriesMany(tenantId, kind, entityIds, keys, o) {
      const res = o.bucket && o.bucket !== 'auto' ? o.bucket : resolutionFor(o.from, o.to);
      assertWindow(o.from, o.to, res);
      const ids = [...new Set(entityIds.map((e) => e.toLowerCase()))];
      if (ids.length > MAX_MANY_ENTITIES) throw new TelemetryQueryError(`more than ${MAX_MANY_ENTITIES} entities in one read`, 'too_many_entities');
      const k = await kindOf(kind);
      const empty: SeriesManyResult = res === 'raw' ? { bucket: 'raw', points: new Map(), truncated: false } : { bucket: res, rows: new Map(), truncated: false };
      if (!k || !ids.length || !keys.length) return empty;
      const lane = laneOf(k);
      return d.inTenant(tenantId, async (db): Promise<SeriesManyResult> => {
        const kindId = await kindIdOf(db, kind);
        if (res === 'raw') {
          const wanted = new Set(keys);
          const r = await rawMessages(db, tenantId, kind, lane, kindId, ids, o.from, o.to, MAX_MESSAGE_ROWS);
          const points = new Map<string, Record<string, TelemetryPoint[]>>();
          for (const m of r.rows) {
            for (const [key, value] of Object.entries(m.values)) {
              if (!wanted.has(key)) continue;
              const rec = points.get(m.entityId) ?? points.set(m.entityId, {}).get(m.entityId)!;
              (rec[key] ??= []).push({ ts: m.ts, value });
            }
          }
          return { bucket: 'raw', points, truncated: r.truncated };
        }
        const keyIds = await keyIdsOf(db, tenantId, keys);
        const rows = new Map<string, Record<string, AggPoint[]>>();
        if (!keyIds.size) return { bucket: res, rows, truncated: false };
        const byKeyId = new Map<number, string>([...keyIds].map(([key, id]) => [id, key]));
        const r = await aggRowsMany(db, tenantId, kind, lane, kindId, ids, [...keyIds.values()], res, o.from, o.to, MAX_AGG_ROWS);
        for (const a of r.rows) {
          const key = byKeyId.get(Number(a.keyId));
          if (!key) continue;
          const rec = rows.get(a.entityId) ?? rows.set(a.entityId, {}).get(a.entityId)!;
          (rec[key] ??= []).push({ ts: new Date(a.ts).getTime(), sum: Number(a.sum), count: Number(a.count), min: Number(a.min), max: Number(a.max), last: Number(a.last) });
        }
        for (const rec of rows.values()) for (const list of Object.values(rec)) list.sort((x, y) => x.ts - y.ts);
        return { bucket: res, rows, truncated: r.truncated };
      });
    },

    async series(tenantId, kind, entityId, keys, o) {
      const res = o.bucket && o.bucket !== 'auto' ? o.bucket : resolutionFor(o.from, o.to);
      assertWindow(o.from, o.to, res);
      const k = await kindOf(kind);
      const out: Record<string, TelemetryPoint[]> = {};
      if (!k || !keys.length) return out;
      const lane = laneOf(k);
      const limit = Math.max(1, Math.min(o.limit ?? MAX_SERIES_POINTS, MAX_SERIES_POINTS));
      const agg: SeriesAgg = o.agg ?? 'avg';
      return d.inTenant(tenantId, async (db) => {
        const kindId = await kindIdOf(db, kind);
        const ids = await keyIdsOf(db, tenantId, keys);
        for (const key of keys) out[key] = [];
        if (!ids.size) return out;
        if (res === 'raw') {
          for (const [key, keyId] of ids) out[key] = await rawPoints(db, tenantId, kind, lane, kindId, entityId, keyId, key, o.from, o.to, limit);
          return out;
        }
        const rows = await aggRows(db, tenantId, kind, lane, kindId, entityId, [...ids.values()], res, o.from, o.to);
        const byKeyId = new Map<number, string>([...ids].map(([key, id]) => [id, key]));
        const grouped = new Map<string, AggRow[]>();
        for (const r of rows) {
          const key = byKeyId.get(Number(r.keyId));
          if (!key) continue;
          (grouped.get(key) ?? grouped.set(key, []).get(key)!).push(r);
        }
        for (const [key, rs] of grouped) {
          rs.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
          const sliced = rs.slice(0, limit);
          out[key] = agg === 'increase'
            ? increases(sliced.map((r) => ({ ts: new Date(r.ts).getTime(), min: Number(r.min), last: Number(r.last) })))
            : sliced.map((r) => ({ ts: new Date(r.ts).getTime(), value: valueOf(agg, r) }));
        }
        return out;
      });
    },
  };
}

let service: TelemetryQueryService | null = null;

/** The read service of this process (tenant transactions through `withTenantTransactionFor`, the `db:time_series` access views). */
export function getTelemetryQueryService(): TelemetryQueryService {
  service ??= createTelemetryQueryService({
    inTenant: async (tenantId, fn) => {
      const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db/server/db.context');
      return withTenantTransactionFor(tenantId, (qr) => fn(qr));
    },
    accessRel: async (db, table) => (await import('@kuraykaraaslan-labs/db/server/db.time-series')).timeSeriesAccessRel(db, table),
  });
  return service;
}
