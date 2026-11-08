import { rowsOf, type SqlRunner } from '@kuraykaraaslan-labs/db/server/db.timescale';
import type { RetentionClass, TelemetryValue, TelemetryWriteResult, TelemetryWriteRow, TelemetryWriter } from './telemetry.contract';
import { dirtyTableOf, latestTableOf, oldestRawTs, rawTableOf } from './telemetry.classes';
import { ClassBindingResolver } from './telemetry.class-binding';
import { WriteBudget } from './telemetry.budget';
import { isConnectionError, rowFailureReason } from './telemetry.errors';
import { msgHashOf } from './telemetry.hash';
import { TelemetryKeyDictionary, type KeyLookup } from './telemetry.key-dictionary';
import { cachedKindId, classOfKind, ensureTelemetryKindsLoaded, isRawKey, keyProblem, laneOf, maxKeysOf, resolveKindId, telemetryKindOf, type TelemetryEntityKind } from './telemetry.kinds';
import { dispatchCommitted, telemetryCommitListeners, type TelemetryCommitListener, type TelemetryCommitted } from './telemetry.listeners';
import { closedMinuteEdge, MINUTE_MS } from './telemetry.minute-window';
import { checkValue, MAX_RAW_BYTES } from './telemetry.rules';
import { TouchedPairs } from './telemetry.touched';

export type { TelemetryCommitListener, TelemetryCommitted } from './telemetry.listeners';
export { registerTelemetryCommitListener } from './telemetry.listeners';

/**
 * `TelemetryWriter` (docs/phases/42-telemetry/00 §0.3, §0.8, §0.8b; the IoT history: 02 P0-T-08/08b/21, OD-87, OD-95, OD-144): the
 * one path that stores readings, called by a kind's writer once per wave of rows of ONE kind.
 *
 * One call is one tenant and one kind:
 *  0. The kind must be registered (`telemetry:entity_kind`), and the wave within the kind's budget (one token-bucket check per
 *     wave; `iot_device` has no budget and skips it). An unknown kind or an exhausted budget refuses every row.
 *  1. Each row is checked with the key and value rules (`telemetry.rules.ts`, then the kind's own key rule): a caller may have
 *     changed the payload on the way. A bad key or value is left out; a row with nothing left, a bad entity id or timestamp, or a
 *     timestamp older than the class's raw retention (`too_old`) is reported in `errors` and not written.
 *  2. A short tenant transaction resolves the tenant's retention class FOR THE KIND, the kind's id (`telemetry_kinds`) and the ids of its keys (`telemetry_keys`,
 *     creating new ones, the kind's cap applied); ids reach the caches only after it committed. A new key over the cap is left
 *     out (`key_limit` when nothing is left).
 *  3. One tenant transaction writes the rows: the raw message rows through the lane's class table access view
 *     (`timeSeriesAccessRel`) with `INSERT … ON CONFLICT DO NOTHING` (per-message idempotency: `msgHash`, the primary key
 *     `(tenantId, entityId, ts, msgHash)`), at most 5 000 rows per statement; then the lane's latest table for the rows actually
 *     inserted, strictly newer `ts` only, with the kind's id (ED-10); then a dirty-minute hint when inserted rows fall into minutes the
 *     minute job may already have closed (late data).
 *  4. After COMMIT the touched pair is recorded for the lane's rollup job, and the commit listeners are QUEUED (ED-11): they run
 *     after this promise resolved and are never awaited here, so nothing they do lengthens the caller's wave.
 *
 * Failures: a connection-level failure is thrown as it is (the caller pauses, nothing is dead-lettered). A statement-level
 * failure of a batch is retried row by row under savepoints, and each row that still fails is reported as
 * `save_failed:<SQLSTATE>` while the others are stored. Only `values` are stored (no metadata).
 */
export const MAX_ROWS_PER_STATEMENT = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TelemetryWriterDeps {
  /** One transaction scoped to the tenant (its RLS context, its own database): `withTenantTransactionFor`. */
  inTenant: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  /** The relation a time-series table is written through: `timeSeriesAccessRel` (the owner-owned `<table>_v` in Timescale mode). */
  accessRel: (db: SqlRunner, table: string) => Promise<string>;
  keys: TelemetryKeyDictionary;
  classes: ClassBindingResolver;
  budget?: WriteBudget;
  /** Records the `(lane, tenant, class)` a wave wrote, for the rollup job (`TouchedPairs.touch`); never awaited. */
  touch?: (lane: string, tenantId: string, classDays: RetentionClass) => void;
  /** Loads the kind contributions when a kind is not registered yet (`ensureTelemetryKindsLoaded` by default). */
  loadKinds?: () => Promise<void>;
  now?: () => number;
  maxRowsPerStatement?: number;
  /** The listeners of committed writes; queued after the write resolved, never awaited. Default: the registered ones. */
  listeners?: () => readonly TelemetryCommitListener[];
  warn?: (text: string) => void;
}

interface Prepared {
  index: number;
  entityId: string;
  ts: number;
  values: Record<string, TelemetryValue>;
}

interface Ready extends Prepared {
  numKeyIds: number[];
  numVals: number[];
  other: Record<string, TelemetryValue> | null;
  hash: string;
  /** Per key id, the value as stored (for the latest upsert). */
  byKey: Array<{ keyId: number; key: string; value: TelemetryValue }>;
}

const rowKey = (entityId: string, ts: number, hash: string) => `${entityId.toLowerCase()}|${ts}|${hash}`;
const minuteOf = (ts: number) => Math.floor(ts / MINUTE_MS) * MINUTE_MS;
/** A Postgres array literal of numbers (`{1,2.5,-3e+21}`); every value is finite (the rules refuse the others). */
const pgNumArray = (xs: readonly number[]) => `{${xs.map((x) => String(x)).join(',')}}`;
const allRows = (rows: readonly unknown[], reason: string): TelemetryWriteResult => ({ written: 0, duplicates: 0, errors: rows.map((_, index) => ({ index, reason })), latestChanged: [], inserted: [] });

export function createTelemetryWriter(d: TelemetryWriterDeps): TelemetryWriter {
  const now = d.now ?? Date.now;
  const perStatement = d.maxRowsPerStatement ?? MAX_ROWS_PER_STATEMENT;
  const budget = d.budget ?? new WriteBudget();
  const loadKinds = d.loadKinds ?? ensureTelemetryKindsLoaded;
  const unknownWarned = new Set<string>();

  const kindOf = async (kind: string): Promise<TelemetryEntityKind | undefined> => {
    let k = telemetryKindOf(kind);
    if (!k) {
      await loadKinds();
      k = telemetryKindOf(kind);
    }
    return k;
  };

  return {
    async write(tenantId: string, kind: string, rows: readonly TelemetryWriteRow[]): Promise<TelemetryWriteResult> {
      const result: TelemetryWriteResult = { written: 0, duplicates: 0, errors: [], latestChanged: [], inserted: [] };
      if (!rows.length) return result;
      if (!UUID.test(tenantId)) return allRows(rows, 'invalid_tenant');

      // 0. the kind and its budget, once per wave
      const k = await kindOf(kind);
      if (!k) {
        if (!unknownWarned.has(kind)) {
          unknownWarned.add(kind);
          d.warn?.(`a write names the unregistered kind "${kind}": refused (telemetry:entity_kind)`);
        }
        return allRows(rows, 'unknown_kind');
      }
      const at = now();
      if (!budget.admit(k, tenantId, rows.length, at)) {
        d.warn?.(`kind ${kind}: tenant ${tenantId} is over its write budget (${rows.length} rows refused)`);
        return allRows(rows, 'over_budget');
      }
      const lane = laneOf(k);

      // 1. the rules, per row (the generic rule, then the kind's)
      const prepared: Prepared[] = [];
      rows.forEach((r, index) => {
        if (typeof r?.entityId !== 'string' || !UUID.test(r.entityId)) return void result.errors.push({ index, reason: 'invalid_entity' });
        if (typeof r.ts !== 'number' || !Number.isSafeInteger(r.ts) || r.ts < 0) return void result.errors.push({ index, reason: 'bad_ts' });
        const values: Record<string, TelemetryValue> = {};
        let firstDrop: string | null = null;
        for (const [key, v] of Object.entries(r.values ?? {})) {
          const bad = keyProblem(k, key);
          if (bad) { firstDrop ??= bad; continue; }
          // a raw key: the caller applied its own cap; here only the largest any caller may set
          const c = checkValue(v, { raw: isRawKey(k, key), rawMaxBytes: MAX_RAW_BYTES });
          if (c.kind === 'skip') continue;
          if (c.kind === 'drop') { firstDrop ??= c.reason; continue; }
          values[key] = c.value;
        }
        if (!Object.keys(values).length) return void result.errors.push({ index, reason: firstDrop ? `no_values:${firstDrop}` : 'no_values' });
        prepared.push({ index, entityId: r.entityId.toLowerCase(), ts: r.ts, values });
      });
      if (!prepared.length) return sortErrors(result);

      // 2. the class first, then key ids only for the rows inside its raw retention: a row older than that is refused as `too_old`
      //    before any key id is made for it, so data that is never stored cannot fill the tenant's key dictionary (it counts
      //    against the key cap). An uncached tenant+kind resolves both in one short transaction, committed before the write.
      const split = (cls: RetentionClass): { kept: Prepared[]; stale: Prepared[] } => {
        const oldest = oldestRawTs(cls, at);
        return { kept: prepared.filter((p) => p.ts >= oldest), stale: prepared.filter((p) => p.ts < oldest) };
      };
      const keysOf = (xs: readonly Prepared[]): string[] => [...new Set(xs.flatMap((p) => Object.keys(p.values)))];
      const cap = maxKeysOf(k, tenantId);
      let classDays = d.classes.cached(tenantId, kind);
      let kindId = cachedKindId(kind);
      let byAge: { kept: Prepared[]; stale: Prepared[] };
      let lookup: KeyLookup | null = null;
      if (classDays !== undefined && kindId !== undefined) {
        byAge = split(classDays);
        const kept = byAge.kept;
        const quick = kept.length ? d.keys.cached(tenantId, keysOf(kept)) : null;
        if (quick && !quick.missing.length) lookup = { ids: quick.ids, refused: [], fromDb: new Map() };
        else if (kept.length) {
          lookup = await d.inTenant(tenantId, (db) => d.keys.idsOf(db, tenantId, keysOf(kept), cap));
          await d.keys.publish(tenantId, lookup); // committed: now the cache may serve them
        }
      } else {
        const prep = await d.inTenant(tenantId, async (db) => {
          const cls = await d.classes.resolve(db, tenantId, kind, () => classOfKind(k, tenantId));
          const id = await resolveKindId(db, kind);
          const r = split(cls);
          return { cls, id, r, keys: r.kept.length ? await d.keys.idsOf(db, tenantId, keysOf(r.kept), cap) : null };
        });
        classDays = prep.cls;
        kindId = prep.id;
        byAge = prep.r;
        lookup = prep.keys;
        // committed: now the caches may serve them
        d.classes.remember(tenantId, kind, prep.cls);
        if (lookup) await d.keys.publish(tenantId, lookup);
      }
      const cls = classDays;
      const kid = kindId;
      for (const p of byAge.stale) result.errors.push({ index: p.index, reason: 'too_old' });
      if (!byAge.kept.length || !lookup) return sortErrors(result);
      const fresh = byAge.kept;

      // the stored shape of each row: numbers by key id, the rest by name; keys over the cap left out
      const refused = new Set(lookup.refused);
      const ready: Ready[] = [];
      for (const p of fresh) {
        const values: Record<string, TelemetryValue> = {};
        const numKeyIds: number[] = [];
        const numVals: number[] = [];
        const other: Record<string, TelemetryValue> = {};
        const byKey: Ready['byKey'] = [];
        for (const [key, v] of Object.entries(p.values)) {
          const keyId = lookup.ids.get(key);
          if (refused.has(key) || keyId === undefined) continue;
          values[key] = v;
          byKey.push({ keyId, key, value: v });
          if (typeof v === 'number') { numKeyIds.push(keyId); numVals.push(v); } else other[key] = v;
        }
        if (!byKey.length) { result.errors.push({ index: p.index, reason: 'key_limit' }); continue; }
        ready.push({ ...p, values, numKeyIds, numVals, other: Object.keys(other).length ? other : null, hash: msgHashOf(values), byKey });
      }

      // the same message twice in one wave is one row: the later copies are duplicates
      const seen = new Set<string>();
      const unique: Ready[] = [];
      for (const r of ready) {
        const key = rowKey(r.entityId, r.ts, r.hash);
        if (seen.has(key)) result.duplicates += 1;
        else { seen.add(key); unique.push(r); }
      }
      if (!unique.length) return sortErrors(result);

      // 3. one tenant transaction: rows, latest, dirty-minute hint
      const latestTable = latestTableOf(lane);
      const dirtyTable = dirtyTableOf(lane);
      const committed = await d.inTenant(tenantId, async (db) => {
        const rel = await d.accessRel(db, rawTableOf(cls, lane));
        const inserted = new Set<string>();
        const failed = new Map<number, string>();
        for (let i = 0; i < unique.length; i += perStatement) {
          const chunk = unique.slice(i, i + perStatement);
          await db.query('SAVEPOINT telemetry_batch');
          try {
            for (const key of await insertRows(db, rel, tenantId, kid, chunk)) inserted.add(key);
            await db.query('RELEASE SAVEPOINT telemetry_batch');
          } catch (e) {
            if (isConnectionError(e)) throw e;
            await db.query('ROLLBACK TO SAVEPOINT telemetry_batch');
            // a statement-level failure: row by row, so one bad row does not cost the others
            for (const r of chunk) {
              await db.query('SAVEPOINT telemetry_row');
              try {
                for (const key of await insertRows(db, rel, tenantId, kid, [r])) inserted.add(key);
                await db.query('RELEASE SAVEPOINT telemetry_row');
              } catch (re) {
                if (isConnectionError(re)) throw re;
                await db.query('ROLLBACK TO SAVEPOINT telemetry_row');
                failed.set(r.index, rowFailureReason(re));
              }
            }
          }
        }
        const stored = unique.filter((r) => inserted.has(rowKey(r.entityId, r.ts, r.hash)));
        const latestChanged = stored.length ? await upsertLatest(db, latestTable, tenantId, kid, stored) : [];
        // late rows: minutes the job may already have aggregated get a hint, committed with the rows
        const edge = closedMinuteEdge(at);
        const late = stored.filter((r) => r.numKeyIds.length && r.ts < edge);
        if (late.length) {
          const from = minuteOf(Math.min(...late.map((r) => r.ts)));
          const to = minuteOf(Math.max(...late.map((r) => r.ts))) + MINUTE_MS;
          await db.query(
            `INSERT INTO "${dirtyTable}" ("tenantId", "classDays", "dirtyFrom", "dirtyTo") VALUES ($1, $2, $3, $4)`,
            [tenantId, cls, new Date(from), new Date(to)],
          );
        }
        return { stored, failed, latestChanged };
      });

      for (const [index, reason] of committed.failed) result.errors.push({ index, reason });
      result.written = committed.stored.length;
      result.inserted = committed.stored.map((r) => r.index).sort((a, b) => a - b);
      result.duplicates += unique.length - committed.stored.length - committed.failed.size;
      result.latestChanged = committed.latestChanged;

      // 4. after COMMIT: the touched pair for the rollup job, and the listeners (queued, never awaited here)
      if (committed.stored.length) {
        d.touch?.(lane, tenantId, cls);
        const listeners = d.listeners?.() ?? telemetryCommitListeners();
        if (listeners.length) {
          const event: TelemetryCommitted = {
            tenantId, kind, lane, classDays: cls,
            inserted: committed.stored.map((r) => ({ entityId: r.entityId, ts: r.ts, values: r.values })),
            latestChanged: committed.latestChanged,
            datapoints: committed.stored.reduce((n, r) => n + r.byKey.length, 0),
          };
          dispatchCommitted(event, { listeners, warn: d.warn, now });
        }
      }
      return sortErrors(result);
    },
  };
}

function sortErrors(r: TelemetryWriteResult): TelemetryWriteResult {
  r.errors.sort((a, b) => a.index - b.index);
  return r;
}

/**
 * Times travel as epoch milliseconds (`int8`) and become `timestamptz` in SQL (`'epoch' + ms`, exact integer arithmetic, so a replay
 * hits the same key): a `Date` per row made the driver format and parse a time-zone string for every row and value, a measurable
 * share of the writer's CPU at thousands of messages a second.
 */
const MS_TO_TS = (col: string): string => `('epoch'::timestamptz + ${col} * interval '1 millisecond')`;

/** One multi-row INSERT through the access view; returns the keys of the rows actually inserted (a conflict inserts nothing). */
async function insertRows(db: SqlRunner, rel: string, tenantId: string, kindId: number, rows: readonly Ready[]): Promise<string[]> {
  const res = rowsOf<{ entityId: string; tsMs: string | number; msgHash: string | number }>(await db.query(
    `INSERT INTO ${rel} ("tenantId", "entityId", "ts", "msgHash", "kindId", "numKeyIds", "numVals", "other")
     SELECT $1::uuid, u.e, ${MS_TO_TS('u.t')}, u.h, $8::smallint, u.k::int4[], u.v::float8[], u.o::jsonb
       FROM unnest($2::uuid[], $3::int8[], $4::int8[], $5::text[], $6::text[], $7::text[]) AS u(e, t, h, k, v, o)
     ON CONFLICT DO NOTHING
     RETURNING "entityId", (extract(epoch FROM "ts") * 1000)::int8 AS "tsMs", "msgHash"`,
    [
      tenantId,
      rows.map((r) => r.entityId),
      rows.map((r) => r.ts),
      rows.map((r) => r.hash),
      rows.map((r) => pgNumArray(r.numKeyIds)),
      rows.map((r) => pgNumArray(r.numVals)),
      rows.map((r) => (r.other ? JSON.stringify(r.other) : null)),
      kindId,
    ],
  ));
  return res.map((x) => rowKey(String(x.entityId), Number(x.tsMs), String(x.msgHash)));
}

/**
 * The lane's latest table for the rows just inserted: per entity and key the newest of the wave (the first at an equal ts),
 * written only where it is strictly newer than the stored one. Returns the keys whose latest value moved.
 */
async function upsertLatest(db: SqlRunner, table: string, tenantId: string, kindId: number, stored: readonly Ready[]): Promise<TelemetryWriteResult['latestChanged']> {
  const best = new Map<string, { entityId: string; keyId: number; key: string; ts: number; value: TelemetryValue }>();
  for (const r of stored) {
    for (const b of r.byKey) {
      const k = `${r.entityId}\u0000${b.keyId}`;
      const have = best.get(k);
      if (!have || r.ts > have.ts) best.set(k, { entityId: r.entityId, keyId: b.keyId, key: b.key, ts: r.ts, value: b.value });
    }
  }
  // one lock order for every writer: waves written at once never wait on each other's rows in a cycle
  const items = [...best.values()].sort((a, b) => (a.entityId < b.entityId ? -1 : a.entityId > b.entityId ? 1 : a.keyId - b.keyId));
  const res = rowsOf<{ entityId: string; keyId: number }>(await db.query(
    `INSERT INTO "${table}" ("tenantId", "kindId", "entityId", "keyId", "ts", "numVal", "other", "updatedAt")
     SELECT $1::uuid, $7::smallint, u.e, u.k, ${MS_TO_TS('u.t')}, u.n, u.o::jsonb, now()
       FROM unnest($2::uuid[], $3::int4[], $4::int8[], $5::float8[], $6::text[]) AS u(e, k, t, n, o)
     ON CONFLICT ("tenantId", "entityId", "keyId") DO UPDATE
       SET "ts" = EXCLUDED."ts", "numVal" = EXCLUDED."numVal", "other" = EXCLUDED."other", "kindId" = EXCLUDED."kindId", "updatedAt" = now()
       WHERE EXCLUDED."ts" > "${table}"."ts"
     RETURNING "entityId", "keyId"`,
    [
      tenantId,
      items.map((x) => x.entityId),
      items.map((x) => x.keyId),
      items.map((x) => x.ts),
      items.map((x) => (typeof x.value === 'number' ? x.value : null)),
      items.map((x) => (typeof x.value === 'number' ? null : JSON.stringify(x.value))),
      kindId,
    ],
  ));
  const moved = new Set(res.map((x) => `${String(x.entityId).toLowerCase()}\u0000${Number(x.keyId)}`));
  return items
    .filter((x) => moved.has(`${x.entityId}\u0000${x.keyId}`))
    .map((x) => ({ entityId: x.entityId, key: x.key, ts: x.ts, value: x.value }));
}

// ── the process writer ─────────────────────────────────────────────────────────────────────────────────────────────────────────

let writer: TelemetryWriter | null = null;
let sharedKeys: TelemetryKeyDictionary | null = null;
let touched: TouchedPairs | null = null;

const warn = (text: string): void => void import('@kuraykaraaslan-labs/logger').then(({ default: Logger }) => Logger.warn(`[telemetry] ${text}`));

/** The touched-pair recorder of this process (the platform Redis); shared by the writer and the rollup job's fallback. */
export function processTouchedPairs(): TouchedPairs {
  touched ??= new TouchedPairs({
    redis: {
      sadd: async (key, ...members) => (await import('@kuraykaraaslan-labs/redis')).default.sadd(key, ...members),
      expire: async (key, seconds) => (await import('@kuraykaraaslan-labs/redis')).default.expire(key, seconds),
      sunion: async (...keys) => (await import('@kuraykaraaslan-labs/redis')).default.sunion(...keys),
    },
    warn,
  });
  return touched;
}

/**
 * The writer of this process: tenant transactions through `withTenantTransactionFor`, the access view of `db:time_series`, the
 * platform Redis as the key cache and the touched-pair set. Built on first use; the platform modules are loaded then, not at import.
 */
export function getTelemetryWriter(): TelemetryWriter {
  if (writer) return writer;
  const keys = new TelemetryKeyDictionary({
    redis: {
      hmget: async (key, ...fields) => (await import('@kuraykaraaslan-labs/redis')).default.hmget(key, ...fields),
      hset: async (key, values) => (await import('@kuraykaraaslan-labs/redis')).default.hset(key, values),
    },
    warn,
  });
  sharedKeys = keys;
  const pairs = processTouchedPairs();
  writer = createTelemetryWriter({
    inTenant: async (tenantId, fn) => {
      const { withTenantTransactionFor } = await import('@kuraykaraaslan-labs/db/server/db.context');
      return withTenantTransactionFor(tenantId, (qr) => fn(qr));
    },
    accessRel: async (db, table) => (await import('@kuraykaraaslan-labs/db/server/db.time-series')).timeSeriesAccessRel(db, table),
    keys,
    classes: new ClassBindingResolver(),
    touch: (lane, tenantId, cls) => pairs.touch(lane, tenantId, cls),
    warn,
  });
  return writer;
}

/** The key dictionary of the process writer, shared with the query service so both read the same caches. */
export function processKeyDictionary(): TelemetryKeyDictionary {
  getTelemetryWriter();
  return sharedKeys!;
}
