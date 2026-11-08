import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { TimeSeriesTable } from '@kuraykaraaslan-labs/db/server/db.time-series';
import { DEFAULT_LANE, DEFAULT_RETENTION_CLASS, type RetentionClass } from './telemetry.contract';
import { DAY_MS, dirtyTableOf, isRetentionClass, minuteTableOf, rawRetentionDays, rawTableOf, stateTableOf } from './telemetry.classes';
import { ClassBindingResolver } from './telemetry.class-binding';
import { closedMinuteEdge, MINUTE_MS } from './telemetry.minute-window';
import { minuteTableDecl } from './telemetry.timeseries';
import type { TouchedPair } from './telemetry.touched';

/**
 * The 1-minute aggregates (docs/phases/42-telemetry/00 §0.8b, ED-12; the IoT history: 00 P0-T-07b, 02 P0-T-08b): this module's own
 * job per lane, because the generic rollups of `db:time_series` cannot unnest the raw rows' arrays. Per tenant and retention
 * class, one tenant transaction per step (RLS applies, tenants are never mixed), in this order:
 *
 *  1. the fresh window `[watermark, closed edge)`, one slice per step (an hour, shrunk under load: `runMinuteRollups`): the minutes
 *     are aggregated from the raw rows (`unnest(numKeyIds, numVals)`: sum, count, min, max and the last value of each numeric key of
 *     each entity) and upserted into `<lane>_1m_r{d}` through its access view, rewriting only buckets whose values changed; the
 *     watermark moves forward;
 *  2. the dirty-minute hints the writer left for late rows (`<lane>_1m_dirty`), merged, clipped to `[raw floor, watermark)`,
 *     recomputed the same way and deleted in that transaction.
 *
 * Which pairs a run visits: the `(tenant, class)` pairs the writer TOUCHED in the last minutes (`TouchedPairs`), so an idle pair
 * costs nothing; without that answer (Redis down, or a periodic full sweep) every tenant and every class of the lane's kinds.
 *
 * Every window it writes is handed to `markRollupDirty` on the 1-minute declaration, which queues the hour rollup's recompute for
 * an hour `db`'s job already closed; `db-time-series-rollup` then refreshes the hour and day tables. Idempotent: a minute is
 * recomputed whole from its raw rows, the watermark only moves forward, and a transaction-level advisory lock per lane, tenant and
 * class makes an overlapping run skip instead of duplicating work. A first run starts at the tenant's oldest raw row.
 */
export const SLICE_MS = 60 * MINUTE_MS;
/** The smallest slice a step shrinks to (one minute). */
export const MIN_SLICE_MS = MINUTE_MS;
/** How long one step (one transaction) should take; slower steps shrink the next slice, faster ones grow it back (at most x2). */
export const STEP_TARGET_MS = 2_000;
/** The share of one database connection's time the job may take while it catches up: it rests between steps for the rest. */
export const DEFAULT_DB_SHARE = 0.5;
export const DEFAULT_MAX_STEPS = 30;
export const DIRTY_BATCH = 500;
const ORIGIN = `TIMESTAMPTZ '2000-01-01 00:00:00+00'`;

export interface MinuteRunOptions {
  /** The lane whose tables the run aggregates. */
  lane?: string;
  /** The tenants to aggregate on a full sweep (those that ever wrote telemetry). */
  tenants: () => Promise<string[]>;
  /**
   * The pairs written recently (`TouchedPairs.pairs`); `null` means "unknown": the run falls back to `tenants()` × the classes
   * of the lane's kinds. Absent: always the full sweep.
   */
  pairs?: () => Promise<TouchedPair[] | null>;
  /** The kinds of the lane (their bindings give the classes on a full sweep); `null` = every kind. */
  kinds?: readonly string[] | null;
  /** One tenant-scoped transaction (`withTenantTransactionFor`); never a bypass. */
  scope: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  /** `timeSeriesAccessRel`: the `<table>_v` view in Timescale mode, the table otherwise. */
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  /** `markRollupDirty` of db: queues the hour rollup's recompute of a window it already closed. */
  markRollupDirty: (db: SqlRunner, t: TimeSeriesTable, tenantId: string, minTs: Date, maxTs: Date, now?: Date) => Promise<number>;
  now?: Date;
  /** Steps (transactions) per tenant and class per run; the rest continues on the next run. */
  maxSteps?: number;
  /** No new step starts after this; the remainder resumes on the next run. */
  maxRunMs?: number;
  /** See `STEP_TARGET_MS` and `DEFAULT_DB_SHARE` (0 < share <= 1). */
  stepTargetMs?: number;
  dbShare?: number;
  /** The slice of each tenant and class, kept between runs (a module-wide map by default); the clock and the rest, for tests. */
  slices?: Map<string, number>;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface MinuteRunReport {
  tenantId: string;
  classDays: RetentionClass;
  steps: number;
  /** 1-minute rows inserted or changed. */
  rows: number;
  watermark: number | null;
  closedEdge: number;
  /** Work left (steps or time budget, or another run holds the lock). */
  truncated: boolean;
  busy: boolean;
  error?: string;
}

interface StepResult {
  kind: 'fresh' | 'dirty' | 'idle' | 'busy';
  rows: number;
  more: boolean;
  watermark: number | null;
}

const asMs = (v: unknown): number | null => (v === null || v === undefined ? null : new Date(v as string | Date).getTime());
const binDown = (ms: number) => Math.floor(ms / MINUTE_MS) * MINUTE_MS;

/** Aggregates `[from, to)` of one tenant and class into the lane's 1-minute table; returns the rows inserted or changed. */
export async function aggregateMinutes(
  db: SqlRunner, o: Pick<MinuteRunOptions, 'accessRel' | 'markRollupDirty'>, tenantId: string, d: RetentionClass, from: number, to: number, now: Date,
  lane: string = DEFAULT_LANE,
): Promise<number> {
  const raw = await o.accessRel(db, rawTableOf(d, lane));
  const minute = await o.accessRel(db, minuteTableOf(d, lane));
  const res = rowsOf<{ n: number }>(await db.query(
    `WITH agg AS (
       SELECT r."entityId" AS e, u.k AS k, date_bin('1 minute'::interval, r."ts", ${ORIGIN}) AS b, min(r."kindId") AS kid,
              sum(u.v) AS s, count(*) AS c, min(u.v) AS mn, max(u.v) AS mx,
              (array_agg(u.v ORDER BY r."ts" DESC, r."msgHash" DESC))[1] AS l
         FROM ${raw} r CROSS JOIN LATERAL unnest(r."numKeyIds", r."numVals") AS u(k, v)
        WHERE r."tenantId" = $1 AND r."ts" >= $2 AND r."ts" < $3 AND u.k IS NOT NULL AND u.v IS NOT NULL
        GROUP BY 1, 2, 3
     ), up AS (
       INSERT INTO ${minute} AS m ("tenantId", "entityId", "keyId", "ts", "kindId", "sum", "count", "min", "max", "last")
       SELECT $1::uuid, e, k, b, kid, s, c, mn, mx, l FROM agg
       ON CONFLICT ("tenantId", "entityId", "keyId", "ts") DO UPDATE
         SET "sum" = EXCLUDED."sum", "count" = EXCLUDED."count", "min" = EXCLUDED."min", "max" = EXCLUDED."max", "last" = EXCLUDED."last"
         WHERE (m."sum", m."count", m."min", m."max", m."last") IS DISTINCT FROM (EXCLUDED."sum", EXCLUDED."count", EXCLUDED."min", EXCLUDED."max", EXCLUDED."last")
       RETURNING 1
     ) SELECT count(*)::int AS n FROM up`,
    [tenantId, new Date(from), new Date(to)],
  ));
  // the hour rollup recomputes an hour it already closed (db's dirty queue); a window it has not reached yet is left to it
  await o.markRollupDirty(db, minuteTableDecl(d, lane), tenantId, new Date(from), new Date(to - 1), now);
  return Number(res[0]?.n ?? 0);
}

async function setWatermark(db: SqlRunner, tenantId: string, d: RetentionClass, to: number, lane: string): Promise<void> {
  const state = stateTableOf(lane);
  await db.query(
    `INSERT INTO "${state}" ("tenantId", "classDays", "watermark", "updatedAt") VALUES ($1, $2, $3, now())
     ON CONFLICT ("tenantId", "classDays") DO UPDATE SET "watermark" = GREATEST("${state}"."watermark", EXCLUDED."watermark"), "updatedAt" = now()`,
    [tenantId, d, new Date(to)],
  );
}

/** One transaction of work for one tenant and class (see the file comment for the order). */
export async function minuteStep(
  db: SqlRunner, o: Pick<MinuteRunOptions, 'accessRel' | 'markRollupDirty'>, tenantId: string, d: RetentionClass, now: Date, sliceMs = SLICE_MS,
  lane: string = DEFAULT_LANE,
): Promise<StepResult> {
  const t = now.getTime();
  const locked = rowsOf<{ ok: boolean }>(await db.query(`SELECT pg_try_advisory_xact_lock(hashtext('telemetry_1m'), hashtext($1)) AS ok`, [`${lane}:${tenantId}:${d}`]))[0];
  if (!locked?.ok) return { kind: 'busy', rows: 0, more: false, watermark: null };
  const state = stateTableOf(lane);
  const dirty = dirtyTableOf(lane);
  const edge = closedMinuteEdge(t);
  const rawFloor = binDown(t - rawRetentionDays(d) * DAY_MS) + MINUTE_MS;
  const wm = asMs(rowsOf<{ wm: unknown }>(await db.query(`SELECT "watermark" AS wm FROM "${state}" WHERE "tenantId" = $1 AND "classDays" = $2`, [tenantId, d]))[0]?.wm);

  // 1. the fresh window
  let start = wm;
  if (start === null) {
    const raw = await o.accessRel(db, rawTableOf(d, lane));
    const first = asMs(rowsOf<{ first: unknown }>(await db.query(`SELECT min("ts") AS first FROM ${raw} WHERE "tenantId" = $1`, [tenantId]))[0]?.first);
    if (first === null) return { kind: 'idle', rows: 0, more: false, watermark: null };
    start = binDown(first);
  }
  const from = Math.max(start, rawFloor);
  if (from < edge) {
    const to = Math.min(edge, from + sliceMs);
    const rows = await aggregateMinutes(db, o, tenantId, d, from, to, now, lane);
    await setWatermark(db, tenantId, d, to, lane);
    return { kind: 'fresh', rows, more: to < edge, watermark: Math.max(to, wm ?? to) };
  }
  if (wm === null) {
    // nothing closed yet: the watermark starts at the first minute, so the hints below have a floor
    await setWatermark(db, tenantId, d, from, lane);
    return { kind: 'idle', rows: 0, more: false, watermark: from };
  }

  // 2. the dirty-minute hints of late rows
  const hints = rowsOf<{ id: string; f: unknown; t: unknown }>(await db.query(
    `SELECT "id", "dirtyFrom" AS f, "dirtyTo" AS t FROM "${dirty}" WHERE "tenantId" = $1 AND "classDays" = $2 ORDER BY "dirtyFrom" LIMIT ${DIRTY_BATCH}`,
    [tenantId, d],
  ));
  if (!hints.length) return { kind: 'idle', rows: 0, more: false, watermark: wm };
  const live: Array<{ id: string; a: number; b: number }> = [];
  const dead: string[] = [];
  for (const h of hints) {
    // the part at or after the watermark is the fresh window's; below the raw floor nothing can be recomputed
    const a = Math.max(asMs(h.f)!, rawFloor);
    const b = Math.min(asMs(h.t)!, wm);
    if (a < b) live.push({ id: h.id, a, b });
    else dead.push(h.id);
  }
  let rows = 0;
  let rest = 0;
  const done = [...dead];
  if (live.length) {
    const ids = [live[0].id];
    const a = live[0].a;
    let b = live[0].b;
    for (const h of live.slice(1)) {
      if (h.a > b) break;
      ids.push(h.id);
      b = Math.max(b, h.b);
    }
    const end = Math.min(b, a + sliceMs);
    rows = await aggregateMinutes(db, o, tenantId, d, a, end, now, lane);
    done.push(...ids);
    if (end < b) {
      await db.query(`INSERT INTO "${dirty}" ("tenantId", "classDays", "dirtyFrom", "dirtyTo") VALUES ($1, $2, $3, $4)`, [tenantId, d, new Date(end), new Date(b)]);
      rest = 1;
    }
    rest += live.length - ids.length;
  }
  if (done.length) await db.query(`DELETE FROM "${dirty}" WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[])`, [tenantId, done]);
  return { kind: 'dirty', rows, more: rest > 0 || hints.length === DIRTY_BATCH, watermark: wm };
}

/** The slice of each tenant and class between runs; bounded by the tenants and classes that ever wrote telemetry. */
const SLICES = new Map<string, number>();

/** The next slice after a step of `slice` that took `took` ms: toward `target`, whole minutes, grown at most twofold. */
export function nextSlice(slice: number, took: number, target: number): number {
  const scaled = slice * Math.min(2, target / Math.max(took, 1));
  return Math.min(SLICE_MS, Math.max(MIN_SLICE_MS, Math.floor(scaled / MINUTE_MS) * MINUTE_MS));
}

const bindings = new ClassBindingResolver();

/** The pairs a run visits: the touched ones when known, otherwise every tenant × the classes its bindings name for the lane's kinds. */
async function pairsToVisit(o: MinuteRunOptions): Promise<Array<TouchedPair & { error?: string }>> {
  const touched = o.pairs ? await o.pairs() : null;
  let out: Array<TouchedPair & { error?: string }>;
  if (touched) {
    // one entry per pair, in a stable order
    const seen = new Set<string>();
    out = touched.filter((p) => { const k = `${p.tenantId}:${p.classDays}`; if (seen.has(k)) return false; seen.add(k); return true; });
  } else {
    out = [];
    for (const tenantId of await o.tenants()) {
      try {
        const classes = await o.scope(tenantId, (db) => bindings.classesOf(db, tenantId, o.kinds ?? null));
        for (const classDays of classes) out.push({ tenantId, classDays });
      } catch (e) {
        out.push({ tenantId, classDays: 30, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  // the default class (IoT's) goes first (02 §2.9, ED-12): a tenant with four classes cannot starve its own hot class of the budget
  return out.sort((a, b) => Number(b.classDays === DEFAULT_RETENTION_CLASS) - Number(a.classDays === DEFAULT_RETENTION_CLASS));
}

/**
 * One pass over the pairs to visit: steps until idle or out of budget. A tenant that fails is reported and never stops the others.
 *
 * A step's slice follows the data rate and the job rests between steps (`stepTargetMs`, `dbShare`): at 5 555 msg/s an hour of raw
 * rows is ~20 M rows, and the load test's catch-up steps of a whole hour took 23–64 s in one transaction while the writers slowed
 * down beside them. In the steady state (one closed minute per run) nothing changes.
 */
export async function runMinuteRollups(o: MinuteRunOptions): Promise<MinuteRunReport[]> {
  const lane = o.lane ?? DEFAULT_LANE;
  const now = o.now ?? new Date();
  const clock = o.clock ?? Date.now;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const slices = o.slices ?? SLICES;
  const target = o.stepTargetMs ?? STEP_TARGET_MS;
  const share = Math.min(1, Math.max(0.05, o.dbShare ?? DEFAULT_DB_SHARE));
  const started = clock();
  const outOfTime = () => o.maxRunMs !== undefined && clock() - started > o.maxRunMs;
  const reports: MinuteRunReport[] = [];
  for (const pair of await pairsToVisit(o)) {
    const { tenantId, classDays: d } = pair;
    const rep: MinuteRunReport = { tenantId, classDays: d, steps: 0, rows: 0, watermark: null, closedEdge: closedMinuteEdge(now.getTime()), truncated: false, busy: false };
    reports.push(rep);
    if (pair.error) { rep.error = pair.error; continue; }
    if (!isRetentionClass(d)) { rep.error = `not a retention class: ${String(d)}`; continue; }
    try {
      // steps until the tenant and class are idle (fresh minutes first, then the hints, one merged group per step)
      for (;;) {
        if (rep.steps >= (o.maxSteps ?? DEFAULT_MAX_STEPS) || outOfTime()) { rep.truncated = true; break; }
        const key = `${lane}:${tenantId}:${d}`;
        const slice = slices.get(key) ?? SLICE_MS;
        const t0 = clock();
        const r = await o.scope(tenantId, (db) => minuteStep(db, o, tenantId, d, now, slice, lane));
        const took = clock() - t0;
        if (r.kind === 'busy') { rep.busy = true; rep.truncated = true; break; }
        rep.watermark = r.watermark;
        if (r.kind === 'idle') break;
        rep.steps += 1;
        rep.rows += r.rows;
        const next = nextSlice(slice, took, target);
        if (next === SLICE_MS) slices.delete(key);
        else slices.set(key, next);
        // the rest of the connection's time is the writers': a step of `took` ms is followed by took * (1 / share - 1) ms of rest
        if (r.more && share < 1) await sleep(Math.round(took * (1 / share - 1)));
      }
    } catch (e) {
      rep.error = e instanceof Error ? e.message : String(e);
    }
  }
  return reports;
}
