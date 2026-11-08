import type { SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { TimeSeriesTable } from '@kuraykaraaslan-labs/db/server/db.time-series';
import type { RetentionClass, TelemetryWriteRow, TelemetryWriter } from './telemetry.contract';
import { DAY_MS, dayTableOf, hourTableOf, minuteRetentionDays, minuteTableOf, oldestRawTs } from './telemetry.classes';
import { ClassBindingResolver } from './telemetry.class-binding';
import { TelemetryKeyDictionary } from './telemetry.key-dictionary';
import { cachedKindId, classOfKind, ensureTelemetryKindsLoaded, keyProblem, laneOf, maxKeysOf, resolveKindId, telemetryKindOf } from './telemetry.kinds';
import { MINUTE_MS } from './telemetry.minute-window';
import { checkValue } from './telemetry.rules';
import { minuteTableDecl } from './telemetry.timeseries';

/**
 * The backfill entry point (docs/phases/42-telemetry/00 §0.8b, 02 §2.9, ED-12): history copied into the store (05 fx snapshots,
 * 08 inventory replay, an import) never goes through the hot writer, which would refuse rows older than the raw window and leave a
 * dirty-minute hint per wave for the live rollup job. A row lands where its age keeps it:
 *
 *  - inside the class's raw window: the writer (raw rows, latest, the minute job aggregates it as usual);
 *  - older, inside the minute retention: aggregated here per (entity, key, minute) and upserted into the minute table; the hour
 *    and day rollups of those hours are queued for db's job (`markRollupDirty`), which recomputes them from the minute rows;
 *  - older still: aggregated here per hour and per day and upserted straight into the hour and day rollup tables.
 *
 * Numeric values only beyond the raw window (the rollups hold numbers). One transaction per age class; idempotent (upserts on the
 * tables' keys; a repeated backfill rewrites the same aggregates). Not a hot path: an offline job's entry point.
 */
export interface BackfillDeps {
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  markRollupDirty: (db: SqlRunner, t: TimeSeriesTable, tenantId: string, minTs: Date, maxTs: Date, now?: Date) => Promise<number>;
  writer: TelemetryWriter;
  keys: TelemetryKeyDictionary;
  classes?: ClassBindingResolver;
  now?: () => number;
}

export interface BackfillResult {
  /** Rows the writer took (inside the raw window). */
  raw: number;
  /** Minute aggregates written. */
  minutes: number;
  /** Hour and day aggregates written. */
  hours: number;
  days: number;
  /** Rows left out: an unknown kind, a non-numeric value beyond the raw window, a bad key or timestamp. */
  skipped: number;
}

interface Agg { sum: number; count: number; min: number; max: number; last: number; lastTs: number }
const aggOf = (): Agg => ({ sum: 0, count: 0, min: Infinity, max: -Infinity, last: 0, lastTs: -1 });
const add = (a: Agg, v: number, ts: number): void => {
  a.sum += v; a.count += 1; a.min = Math.min(a.min, v); a.max = Math.max(a.max, v);
  if (ts >= a.lastTs) { a.last = v; a.lastTs = ts; }
};
const floorTo = (ts: number, size: number): number => Math.floor(ts / size) * size;

export async function backfillReadings(d: BackfillDeps, tenantId: string, kind: string, rows: readonly TelemetryWriteRow[]): Promise<BackfillResult> {
  const result: BackfillResult = { raw: 0, minutes: 0, hours: 0, days: 0, skipped: 0 };
  if (!rows.length) return result;
  let k = telemetryKindOf(kind);
  if (!k) { await ensureTelemetryKindsLoaded(); k = telemetryKindOf(kind); }
  if (!k) { result.skipped = rows.length; return result; }
  const kk = k;
  const now = (d.now ?? Date.now)();
  const classes = d.classes ?? new ClassBindingResolver();
  const lane = laneOf(kk);

  // the class, the kind id and the key ids, in one short transaction (like the writer's)
  const keyNames = [...new Set(rows.flatMap((r) => Object.keys(r.values ?? {})))].filter((key) => !keyProblem(kk, key));
  const prep = await d.inTenant(tenantId, async (db) => {
    const cls = await classes.resolve(db, tenantId, kind, () => classOfKind(kk, tenantId));
    const kindId = cachedKindId(kind) ?? (await resolveKindId(db, kind));
    const keys = keyNames.length ? await d.keys.idsOf(db, tenantId, keyNames, maxKeysOf(kk, tenantId)) : null;
    return { cls, kindId, keys };
  });
  classes.remember(tenantId, kind, prep.cls);
  if (prep.keys) await d.keys.publish(tenantId, prep.keys);
  const cls: RetentionClass = prep.cls;
  const keyIds = prep.keys?.ids ?? new Map<string, number>();

  const rawFloor = oldestRawTs(cls, now);
  const minuteFloor = now - minuteRetentionDays(cls) * DAY_MS;
  const classFloor = now - cls * DAY_MS;
  const fresh: TelemetryWriteRow[] = [];
  const minutes = new Map<string, Agg>(); // `${entity}|${keyId}|${minute}`
  const hours = new Map<string, Agg>();
  const days = new Map<string, Agg>();
  for (const r of rows) {
    if (typeof r?.entityId !== 'string' || typeof r.ts !== 'number' || !Number.isSafeInteger(r.ts) || r.ts < classFloor) { result.skipped += 1; continue; }
    if (r.ts >= rawFloor) { fresh.push(r); continue; }
    let took = false;
    for (const [key, v] of Object.entries(r.values ?? {})) {
      const keyId = keyIds.get(key);
      const c = checkValue(v);
      if (keyId === undefined || c.kind !== 'num') continue;
      took = true;
      const e = r.entityId.toLowerCase();
      if (r.ts >= minuteFloor) {
        const m = `${e}|${keyId}|${floorTo(r.ts, MINUTE_MS)}`;
        add(minutes.get(m) ?? minutes.set(m, aggOf()).get(m)!, c.value, r.ts);
      } else {
        const h = `${e}|${keyId}|${floorTo(r.ts, 3_600_000)}`;
        add(hours.get(h) ?? hours.set(h, aggOf()).get(h)!, c.value, r.ts);
        const dd = `${e}|${keyId}|${floorTo(r.ts, DAY_MS)}`;
        add(days.get(dd) ?? days.set(dd, aggOf()).get(dd)!, c.value, r.ts);
      }
    }
    if (!took) result.skipped += 1;
  }

  if (fresh.length) {
    const w = await d.writer.write(tenantId, kind, fresh);
    result.raw = w.written;
    result.skipped += w.errors.length;
  }

  const split = (key: string): [string, number, number] => { const [e, kid, ts] = key.split('|'); return [e, Number(kid), Number(ts)]; };

  if (minutes.size) {
    await d.inTenant(tenantId, async (db) => {
      const rel = await d.accessRel(db, minuteTableOf(cls, lane));
      const items = [...minutes.entries()].map(([key, a]) => ({ k: split(key), a }));
      await db.query(
        `INSERT INTO ${rel} AS m ("tenantId", "entityId", "keyId", "ts", "kindId", "sum", "count", "min", "max", "last")
         SELECT $1::uuid, u.e, u.k, u.t, $8::smallint, u.s, u.c, u.mn, u.mx, u.l
           FROM unnest($2::uuid[], $3::int4[], $4::timestamptz[], $5::float8[], $6::int8[], $7::float8[], $9::float8[], $10::float8[]) AS u(e, k, t, s, c, mn, mx, l)
         ON CONFLICT ("tenantId", "entityId", "keyId", "ts") DO UPDATE
           SET "sum" = EXCLUDED."sum", "count" = EXCLUDED."count", "min" = EXCLUDED."min", "max" = EXCLUDED."max", "last" = EXCLUDED."last", "kindId" = EXCLUDED."kindId"`,
        [
          tenantId,
          items.map((x) => x.k[0]), items.map((x) => x.k[1]), items.map((x) => new Date(x.k[2])),
          items.map((x) => x.a.sum), items.map((x) => x.a.count), items.map((x) => x.a.min), prep.kindId,
          items.map((x) => x.a.max), items.map((x) => x.a.last),
        ],
      );
      result.minutes = items.length;
      const ts = items.map((x) => x.k[2]);
      await d.markRollupDirty(db, minuteTableDecl(cls, lane), tenantId, new Date(Math.min(...ts)), new Date(Math.max(...ts) + MINUTE_MS - 1), new Date(now));
    });
  }

  const upsertRollup = async (db: SqlRunner, table: string, map: Map<string, Agg>): Promise<number> => {
    const rel = await d.accessRel(db, table);
    const items = [...map.entries()].map(([key, a]) => ({ k: split(key), a }));
    await db.query(
      `INSERT INTO ${rel} AS r ("tenantId", "entityId", "keyId", "bucket", "sum_sum", "count_sum", "min_min", "max_max", "last_last")
       SELECT $1::uuid, u.e, u.k, u.t, u.s, u.c, u.mn, u.mx, u.l
         FROM unnest($2::uuid[], $3::int4[], $4::timestamptz[], $5::float8[], $6::int8[], $7::float8[], $8::float8[], $9::float8[]) AS u(e, k, t, s, c, mn, mx, l)
       ON CONFLICT ("tenantId", "entityId", "keyId", "bucket") DO UPDATE
         SET "sum_sum" = EXCLUDED."sum_sum", "count_sum" = EXCLUDED."count_sum", "min_min" = EXCLUDED."min_min", "max_max" = EXCLUDED."max_max", "last_last" = EXCLUDED."last_last"`,
      [
        tenantId,
        items.map((x) => x.k[0]), items.map((x) => x.k[1]), items.map((x) => new Date(x.k[2])),
        items.map((x) => x.a.sum), items.map((x) => x.a.count), items.map((x) => x.a.min), items.map((x) => x.a.max), items.map((x) => x.a.last),
      ],
    );
    return items.length;
  };
  if (hours.size || days.size) {
    await d.inTenant(tenantId, async (db) => {
      if (hours.size) result.hours = await upsertRollup(db, hourTableOf(cls, lane), hours);
      if (days.size) result.days = await upsertRollup(db, dayTableOf(cls, lane), days);
    });
  }
  return result;
}

/** The oldest row the class keeps anywhere (its day rollups), for callers that pre-filter. */
export const oldestBackfillTs = (cls: RetentionClass, now: number): number => now - cls * DAY_MS;
