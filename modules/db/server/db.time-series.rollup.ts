import Logger from '@kuraykaraaslan-labs/logger';
import { rowsOf, type SqlRunner } from './db.timescale';
import type { TimeSeriesTable } from './db.time-series';
import { tenantPolicyStatements } from './db.rls-policy';

/**
 * Tenant-isolated rollups for time-series tables (docs/phases/10-db phase 5, section 5.7).
 *
 * WHY THIS EXISTS. On TimescaleDB 2.17 / 2.30 a hypertable with row-level
 * security cannot be compressed and cannot be the source of a continuous
 * aggregate (Timescale's materialized views), and a plain materialized view has
 * no RLS at all. Dropping RLS from raw telemetry would trade the isolation
 * boundary for a storage feature, so the declared design keeps RLS on the raw
 * table and gives every tenant-scoped time-series table PRE-AGGREGATED ROLLUP
 * TABLES that are themselves ordinary (hyper)tables with `tenantId`, the same
 * `tenant_isolation` policy and FORCE ROW LEVEL SECURITY. A job fills them
 * incrementally, per tenant, inside the normal tenant chokepoint.
 *
 * (A plain view with `security_invoker = true` is fine as a read-only
 * convenience over an RLS table on PG15+: it runs with the caller's rights, so
 * the raw table's policy still applies. It just is not stored.)
 *
 * Works on plain Postgres: bucketing uses `date_bin` (PG14+), not `time_bucket`.
 * Buckets are aligned to UTC (origin 2000-01-01 00:00:00+00).
 */

export type RollupBucket = '1 minute' | '1 hour' | '1 day';
export type RollupAggregate = 'avg' | 'min' | 'max' | 'sum' | 'count' | 'last';

export interface RollupDecl {
  /** Rollup table name (unquoted identifier), e.g. `iot_ts_1m`. */
  name: string;
  bucket: RollupBucket;
  /** Raw columns the rollup is keyed by besides tenant and bucket, e.g. `['deviceId', 'key']`. Made NOT NULL. */
  groupBy?: string[];
  /** Per raw value column, the aggregates to keep. Output column: `<column>_<aggregate>`. */
  values: Record<string, RollupAggregate[]>;
  /** Rollup rows older than this are dropped (independent of the raw table's retention). */
  retention?: string;
  /** Chunk interval when the table becomes a hypertable (default by bucket). */
  chunkInterval?: string;
  /**
   * Safety-net sweep for rollups aggregated from RAW rows: closed buckets this far behind the watermark are
   * re-aggregated, but only every `sweepEvery` (not every run) and only changed rows are written. Exact late-data
   * handling does not depend on it: ingest can call `markRollupDirty` and only those buckets are redone. Default by
   * bucket (1 minute: 10 minutes, 1 hour: 3 hours, 1 day: 2 days); `'0 minutes'` turns the sweep off (hint-only).
   * Must be shorter than the raw retention. Ignored by a rollup derived from a finer rollup (it follows its source).
   */
  lateWindow?: string;
  /** Minimum time between two sweeps of one (tenant, rollup) (default by bucket: 5 minutes / 30 minutes / 2 hours). */
  sweepEvery?: string;
  /** A bucket counts as closed once its end is this far in the past (default `1 minute`). */
  lag?: string;
  /**
   * Where the buckets are aggregated from. Default (omitted): the coarsest finer rollup of the same table that has the
   * same `groupBy` and keeps every aggregate this one needs (avg needs sum+count or avg+count, sum needs sum or
   * avg+count, count/min/max/last need themselves), otherwise the raw table. `'raw'` forces raw; a rollup name forces
   * that source (validation then requires it to be able to serve this rollup).
   */
  source?: 'raw' | string;
  /** Alert when the watermark of a tenant lags the newest closed bucket by more than this many buckets (default 5). */
  maxLagBuckets?: number;
}

export const ROLLUP_STATE_TABLE = 'time_series_rollup_state';
export const ROLLUP_DIRTY_TABLE = 'time_series_rollup_dirty';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTERVAL = /^\d+\s+(second|minute|hour|day|week|month|year)s?$/i;
const AGGREGATES: readonly RollupAggregate[] = ['avg', 'min', 'max', 'sum', 'count', 'last'];
const ORIGIN = `TIMESTAMPTZ '2000-01-01 00:00:00+00'`;

const BUCKET_MS: Record<RollupBucket, number> = { '1 minute': 60_000, '1 hour': 3_600_000, '1 day': 86_400_000 };
const DEFAULT_CHUNK: Record<RollupBucket, string> = { '1 minute': '1 day', '1 hour': '7 days', '1 day': '30 days' };
const DEFAULT_LATE: Record<RollupBucket, string> = { '1 minute': '10 minutes', '1 hour': '3 hours', '1 day': '2 days' };
const DEFAULT_SWEEP: Record<RollupBucket, string> = { '1 minute': '5 minutes', '1 hour': '30 minutes', '1 day': '2 hours' };
/** `markRollupDirty` writes a hint for rows younger than `lag` too if they are within this slack of the closing edge (ingest transaction time + clock skew). */
export const ROLLUP_HINT_SLACK_MS = 15_000;
export const DEFAULT_MAX_LAG_BUCKETS = 5;
/** One transaction aggregates at most this much time (backfill batching). */
const SLICE_MS: Record<RollupBucket, number> = { '1 minute': 86_400_000, '1 hour': 7 * 86_400_000, '1 day': 90 * 86_400_000 };
const DEFAULT_LAG = '1 minute';
const DEFAULT_MAX_SLICES = 100;
const MAX_IDENT = 63;

const UNIT_MS: Record<string, number> = {
  second: 1000, minute: 60_000, hour: 3_600_000, day: 86_400_000, week: 7 * 86_400_000, month: 30 * 86_400_000, year: 365 * 86_400_000,
};
function intervalMs(interval: string): number {
  const m = interval.trim().match(/^(\d+)\s+([a-z]+?)s?$/i);
  return m ? Number(m[1]) * (UNIT_MS[m[2].toLowerCase()] ?? 0) : 0;
}

const qi = (ident: string): string => {
  if (!IDENT.test(ident)) throw new Error(`[time-series] unsafe identifier "${ident}"`);
  return `"${ident}"`;
};

/** Name of the access view of a hypertable (Timescale mode, see db.time-series.ts `ensureAccessView`). */
export const accessViewName = (table: string): string => `${table}_v`;

const accessCache = new WeakMap<object, Map<string, string>>();
/**
 * The relation the app must read/write for `table`: the owner-owned access view `<table>_v` when it exists
 * (Timescale mode; the hypertable itself grants nothing to app roles), the table otherwise. Cached per
 * connection/transaction object.
 */
export async function accessRel(db: SqlRunner, table: string): Promise<string> {
  const cache = accessCache.get(db) ?? new Map<string, string>();
  accessCache.set(db, cache);
  const hit = cache.get(table);
  if (hit) return hit;
  const view = accessViewName(table);
  const isView = IDENT.test(view) && rowsOf(await db.query(
    `SELECT 1 FROM pg_class WHERE oid = to_regclass($1) AND relkind = 'v'`, [`"${view}"`],
  )).length > 0;
  const rel = qi(isView ? view : table);
  cache.set(table, rel);
  return rel;
}

export const rollupColumn = (column: string, agg: RollupAggregate): string => `${column}_${agg}`;
export const rollupBucketMs = (bucket: RollupBucket): number => BUCKET_MS[bucket];
export const rollupTenantColumn = (t: TimeSeriesTable): string => t.tenantColumn ?? 'tenantId';

/** Pure declaration checks for the `rollups` of one table. */
export function validateRollups(t: TimeSeriesTable, taken: Set<string> = new Set()): string[] {
  const rollups = t.rollups ?? [];
  const problems: string[] = [];
  if (rollups.length === 0) return problems;
  const where = `time-series table "${t.table}"`;
  if (t.tenantColumn === null) {
    problems.push(`${where}: rollups are for tenant-scoped tables (tenantColumn is null); a system table uses continuousAggregates`);
  }
  const tenant = rollupTenantColumn(t);
  for (const r of rollups) {
    const w = `${where}: rollup "${r.name}"`;
    if (!IDENT.test(r.name ?? '')) { problems.push(`${w}: name must be a plain identifier`); continue; }
    if (r.name === t.table || r.name === ROLLUP_STATE_TABLE || r.name === ROLLUP_DIRTY_TABLE || taken.has(r.name)) problems.push(`${w}: name is already used`);
    taken.add(r.name);
    if (!(r.bucket in BUCKET_MS)) problems.push(`${w}: bucket "${r.bucket}" must be '1 minute', '1 hour' or '1 day'`);
    for (const [label, value] of [['retention', r.retention], ['chunkInterval', r.chunkInterval], ['lateWindow', r.lateWindow], ['sweepEvery', r.sweepEvery], ['lag', r.lag]] as const) {
      if (value !== undefined && !INTERVAL.test(value)) problems.push(`${w}: ${label} "${value}" is not "<n> <unit>"`);
    }
    const late = r.lateWindow ?? (r.bucket in BUCKET_MS ? DEFAULT_LATE[r.bucket] : undefined);
    if (t.retention && late && INTERVAL.test(late) && intervalMs(late) >= intervalMs(t.retention)) {
      problems.push(`${w}: lateWindow ${late} must be shorter than the raw retention ${t.retention} (re-aggregating dropped raw rows would overwrite a bucket with partial data)`);
    }
    if (r.maxLagBuckets !== undefined && !(Number.isInteger(r.maxLagBuckets) && r.maxLagBuckets >= 1)) {
      problems.push(`${w}: maxLagBuckets must be an integer >= 1`);
    }
    if (r.source !== undefined && r.source !== 'raw') {
      const src = rollups.find((x) => x.name === r.source);
      if (!src || src === r) problems.push(`${w}: source "${r.source}" is not another rollup of this table`);
      else if (!canDerive(src, r)) {
        problems.push(`${w}: source "${r.source}" cannot serve this rollup (needs a finer bucket that divides ${r.bucket}, the same groupBy and the aggregates it is built from: avg needs sum+count or avg+count, sum needs sum or avg+count, count/min/max/last need themselves)`);
      }
    }
    for (const g of r.groupBy ?? []) {
      if (!IDENT.test(g)) problems.push(`${w}: groupBy column "${g}" is not an identifier`);
      else if (g === 'bucket' || g === tenant || g === t.timeColumn) problems.push(`${w}: groupBy column "${g}" is reserved`);
    }
    const entries = Object.entries(r.values ?? {});
    if (entries.length === 0) problems.push(`${w}: values must name at least one column`);
    const seen = new Set<string>();
    for (const [col, aggs] of entries) {
      if (!IDENT.test(col)) { problems.push(`${w}: value column "${col}" is not an identifier`); continue; }
      if (!Array.isArray(aggs) || aggs.length === 0) problems.push(`${w}: value column "${col}" needs at least one aggregate`);
      for (const a of aggs ?? []) {
        if (!AGGREGATES.includes(a)) problems.push(`${w}: aggregate "${a}" must be one of ${AGGREGATES.join('/')}`);
        const out = rollupColumn(col, a);
        if (out.length > MAX_IDENT) problems.push(`${w}: output column "${out}" exceeds ${MAX_IDENT} characters`);
        if (seen.has(out) || (r.groupBy ?? []).includes(out)) problems.push(`${w}: output column "${out}" is duplicated`);
        seen.add(out);
      }
    }
  }
  return problems;
}

/** The `TimeSeriesTable` a rollup table is managed as (hypertable / indexes / retention reuse the raw code path). */
export function rollupAsTable(t: TimeSeriesTable, r: RollupDecl): TimeSeriesTable {
  return {
    table: r.name, timeColumn: 'bucket', chunkInterval: r.chunkInterval ?? DEFAULT_CHUNK[r.bucket],
    retention: r.retention, tenantColumn: t.tenantColumn,
  };
}

const outputColumns = (r: RollupDecl): { name: string; col: string; agg: RollupAggregate }[] =>
  Object.entries(r.values).flatMap(([col, aggs]) => aggs.map((agg) => ({ name: rollupColumn(col, agg), col, agg })));

const aggSql = (col: string, agg: RollupAggregate, timeCol: string): string => {
  const c = qi(col);
  switch (agg) {
    case 'avg': return `avg(${c}::double precision)`;
    case 'min': return `min(${c}::double precision)`;
    case 'max': return `max(${c}::double precision)`;
    case 'sum': return `sum(${c}::double precision)`;
    case 'count': return `count(${c})`;
    case 'last': return `(array_agg(${c}::double precision ORDER BY ${qi(timeCol)} DESC) FILTER (WHERE ${c} IS NOT NULL))[1]`;
  }
};

async function rawColumnTypes(db: SqlRunner, table: string): Promise<Map<string, string>> {
  const rows = rowsOf<{ name: string; type: string }>(await db.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type FROM pg_attribute a
      WHERE a.attrelid = to_regclass($1) AND a.attnum > 0 AND NOT a.attisdropped`, [qi(table)],
  ));
  return new Map(rows.map((r) => [r.name, r.type]));
}

async function enableTenantRls(db: SqlRunner, table: string, tenantCol: string, grant = true): Promise<void> {
  // The generator's own policy shape (migration 127, db.rls-policy.ts): the
  // tenant_isolation / tenant_admin_bypass pair. FORCE from day one: a rollup
  // table is only ever touched inside a tenant scope, so there is no
  // pre-cutover caller to protect, and it must not lag the raw table.
  await db.query(`ALTER TABLE ${qi(table)} ENABLE ROW LEVEL SECURITY`);
  for (const statement of tenantPolicyStatements(qi(table), qi(tenantCol))) await db.query(statement);
  await db.query(`ALTER TABLE ${qi(table)} FORCE ROW LEVEL SECURITY`);
  // A hypertable must NOT carry app-role grants (chunks copy them and RLS is not inherited by chunks): Timescale
  // mode passes grant=false and the app reaches the table through the owner-owned `<table>_v` view instead.
  if (!grant) return;
  await db.query(
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
         GRANT SELECT, INSERT, UPDATE, DELETE ON ${qi(table)} TO app_runtime; END IF;
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN
         GRANT SELECT, INSERT, UPDATE, DELETE ON ${qi(table)} TO app_admin; END IF;
     END $$`,
  );
}

/** Primary key of the watermark table: tenant first, like every key of a tenant-scoped table (see `entityRuleProblems`). */
const STATE_KEY = ['tenantId', 'rollup'] as const;

/**
 * Column list of a key as the catalog prints it: `PRIMARY KEY ("a", b)` from
 * `pg_get_constraintdef`, or `CREATE UNIQUE INDEX ... USING btree ("a", b) [INCLUDE|WHERE ...]`
 * from `pg_get_indexdef`. Tokens are returned as written (an expression stays one odd token,
 * which is exactly what a "tenant column first" check should trip over).
 */
export function keyColumnsOf(def: unknown): string[] | null {
  const m = typeof def === 'string' ? def.match(/(?:PRIMARY KEY|UNIQUE|USING \w+) \((.*?)\)(?: INCLUDE| WHERE|$)/) : null;
  return m ? m[1].split(',').map((c) => c.trim().replace(/^"|"$/g, '')) : null;
}

/**
 * The watermark table (one row per rollup and tenant), RLS like everything
 * tenant-scoped. Its key is (tenantId, rollup): a table created before the
 * tenant-first rule had (rollup, tenantId) and is re-keyed here in ONE ALTER, so
 * a deploy never sees the table without a primary key.
 */
export async function ensureRollupState(db: SqlRunner): Promise<void> {
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${qi(ROLLUP_STATE_TABLE)} (
       "rollup" varchar(63) NOT NULL, "tenantId" uuid NOT NULL, "watermark" timestamptz NOT NULL,
       "updatedAt" timestamptz NOT NULL DEFAULT now(), PRIMARY KEY ("tenantId", "rollup"))`,
  );
  const pk = rowsOf<{ conname?: string; def?: unknown }>(await db.query(
    `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
      WHERE conrelid = to_regclass($1) AND contype = 'p'`, [qi(ROLLUP_STATE_TABLE)],
  ))[0];
  const cols = keyColumnsOf(pk?.def);
  if (pk?.conname && cols && cols.join() !== STATE_KEY.join()) {
    await db.query(
      `ALTER TABLE ${qi(ROLLUP_STATE_TABLE)} DROP CONSTRAINT "${pk.conname.replace(/"/g, '""')}",
         ADD PRIMARY KEY ("tenantId", "rollup")`,
    );
  }
  await db.query(`ALTER TABLE ${qi(ROLLUP_STATE_TABLE)} ADD COLUMN IF NOT EXISTS "lastSweepAt" timestamptz`);
  await enableTenantRls(db, ROLLUP_STATE_TABLE, 'tenantId');
  // Queue of buckets that received late rows (insert-only hints, consumed by the job). Same tenant isolation.
  await db.query(
    `CREATE TABLE IF NOT EXISTS ${qi(ROLLUP_DIRTY_TABLE)} (
       "tenantId" uuid NOT NULL, "id" uuid NOT NULL DEFAULT gen_random_uuid(), "rollup" varchar(63) NOT NULL,
       "dirtyFrom" timestamptz NOT NULL, "dirtyTo" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL DEFAULT now(),
       PRIMARY KEY ("tenantId", "id"))`,
  );
  await db.query(`CREATE INDEX IF NOT EXISTS ${qi(`${ROLLUP_DIRTY_TABLE}_lookup_idx`)} ON ${qi(ROLLUP_DIRTY_TABLE)} ("tenantId", "rollup", "dirtyFrom")`);
  await enableTenantRls(db, ROLLUP_DIRTY_TABLE, 'tenantId');
}

/**
 * Create (idempotently) the rollup table, its columns, unique key (tenant,
 * groupBy..., bucket) and RLS. Hypertable / index / retention-policy work is
 * done by the caller through the shared code path (`rollupAsTable`).
 */
export async function ensureRollupTable(db: SqlRunner, t: TimeSeriesTable, r: RollupDecl, opts: { grant?: boolean } = {}): Promise<void> {
  const tenant = rollupTenantColumn(t);
  const types = await rawColumnTypes(db, t.table);
  const need = [tenant, ...(r.groupBy ?? []), ...Object.keys(r.values), t.timeColumn];
  const missing = need.filter((c) => !types.has(c));
  if (missing.length) throw new Error(`[time-series] rollup ${r.name}: raw table ${t.table} has no column ${missing.join(', ')}`);

  const keyCols = [tenant, ...(r.groupBy ?? []), 'bucket'];
  const cols = [
    `${qi(tenant)} ${types.get(tenant)} NOT NULL`,
    ...(r.groupBy ?? []).map((g) => `${qi(g)} ${types.get(g)} NOT NULL`),
    `"bucket" timestamptz NOT NULL`,
    ...outputColumns(r).map((o) => `${qi(o.name)} ${o.agg === 'count' ? 'bigint' : 'double precision'}`),
  ];
  await db.query(`CREATE TABLE IF NOT EXISTS ${qi(r.name)} (${cols.join(', ')}, PRIMARY KEY (${keyCols.map(qi).join(', ')}))`);
  // A newly declared aggregate becomes a new column (existing buckets stay NULL until re-backfilled).
  for (const o of outputColumns(r)) {
    await db.query(`ALTER TABLE ${qi(r.name)} ADD COLUMN IF NOT EXISTS ${qi(o.name)} ${o.agg === 'count' ? 'bigint' : 'double precision'}`);
  }
  await db.query(`CREATE INDEX IF NOT EXISTS ${qi(`${r.name}_tenant_bucket_idx`)} ON ${qi(r.name)} (${qi(tenant)}, "bucket" DESC)`);
  await enableTenantRls(db, r.name, tenant, opts.grant !== false);
}

// ─── hierarchical sources ───────────────────────────────────────────────────

const sameSet = (a: string[], b: string[]): boolean => a.length === b.length && a.every((x) => b.includes(x));

/** Aggregates of `s` that answer `agg` of `col` (derivation rules), or null when `s` cannot. */
function derivation(s: RollupDecl, col: string, agg: RollupAggregate): { kind: 'same' | 'avgOfSumCount' | 'avgWeighted' | 'sumFromAvgCount' } | null {
  const has = (a: RollupAggregate) => (s.values[col] ?? []).includes(a);
  switch (agg) {
    case 'min': case 'max': case 'last': case 'count': return has(agg) ? { kind: 'same' } : null;
    case 'sum': return has('sum') ? { kind: 'same' } : has('avg') && has('count') ? { kind: 'sumFromAvgCount' } : null;
    case 'avg': return has('sum') && has('count') ? { kind: 'avgOfSumCount' } : has('avg') && has('count') ? { kind: 'avgWeighted' } : null;
  }
}

/**
 * Can rollup `r` be built from the stored buckets of the finer rollup `s` with exactly the same result as from raw rows?
 * Buckets must nest (UTC-aligned, finer divides coarser), the grouping must match, and every aggregate must be
 * re-combinable: min/max/count/sum are associative, avg is sum/count (or the count-weighted avg), last is the last
 * non-null value of the latest bucket (buckets are disjoint and ordered, so no timestamp is needed).
 */
export function canDerive(s: RollupDecl, r: RollupDecl): boolean {
  if (!(s.bucket in BUCKET_MS) || !(r.bucket in BUCKET_MS)) return false;
  if (BUCKET_MS[s.bucket] >= BUCKET_MS[r.bucket] || BUCKET_MS[r.bucket] % BUCKET_MS[s.bucket] !== 0) return false;
  if (!sameSet(s.groupBy ?? [], r.groupBy ?? [])) return false;
  return Object.entries(r.values ?? {}).every(([col, aggs]) => aggs.every((a) => derivation(s, col, a) !== null));
}

/** The rollup `r` is aggregated from (`null` = the raw table). Pure; see `RollupDecl.source`. */
export function rollupSource(t: TimeSeriesTable, r: RollupDecl): RollupDecl | null {
  const rollups = t.rollups ?? [];
  if (r.source === 'raw') return null;
  if (r.source) { const forced = rollups.find((x) => x.name === r.source); return forced && forced !== r && canDerive(forced, r) ? forced : null; }
  const candidates = rollups.filter((s) => s !== r && canDerive(s, r)).sort((a, b) => BUCKET_MS[b.bucket] - BUCKET_MS[a.bucket]);
  return candidates[0] ?? null;
}

function derivedAggSql(s: RollupDecl, col: string, agg: RollupAggregate): string {
  const d = derivation(s, col, agg)!;
  const c = (a: RollupAggregate) => qi(rollupColumn(col, a));
  switch (agg) {
    case 'min': return `min(${c('min')})`;
    case 'max': return `max(${c('max')})`;
    case 'count': return `COALESCE(sum(${c('count')}), 0)::bigint`;
    case 'last': return `(array_agg(${c('last')} ORDER BY "bucket" DESC) FILTER (WHERE ${c('last')} IS NOT NULL))[1]`;
    case 'sum': return d.kind === 'same' ? `sum(${c('sum')})` : `sum(${c('avg')} * ${c('count')}::double precision)`;
    case 'avg': return d.kind === 'avgOfSumCount'
      ? `sum(${c('sum')})::double precision / NULLIF(sum(${c('count')}), 0)::double precision`
      : `sum(${c('avg')} * ${c('count')}::double precision) / NULLIF(sum(${c('count')}), 0)::double precision`;
  }
}

// ─── the rollup job ─────────────────────────────────────────────────────────

export interface RollupLagAlert {
  table: string; rollup: string; tenantId: string;
  lagBuckets: number; lagMs: number; threshold: number;
  watermark: string | null; closedEdge: string | null; truncated: boolean; error?: string;
}

export interface RollupRunOptions {
  /** Tenant ids to aggregate (platform decides which are active). */
  tenants: () => Promise<string[]>;
  /** One tenant-scoped transaction (`withTenantTransactionFor`). NEVER a bypass: tenants must not be mixed. */
  scope: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>;
  now?: Date;
  /** Aggregating transactions per rollup and tenant per run; the rest continues on the next run. Default 100. */
  maxSlicesPerRun?: number;
  /** Wall-clock budget of the whole run. No new transaction starts after it; unfinished work resumes on the next run. Default: none. */
  maxRunMs?: number;
  /** Alert threshold in buckets when a rollup declares no `maxLagBuckets` (default 5). */
  lagAlertBuckets?: number;
  /** Called once per (tenant, rollup) whose lag exceeds its threshold after the run. Errors thrown here are logged, never propagate. */
  onLag?: (alert: RollupLagAlert) => void | Promise<void>;
  /**
   * Optional cross-process lock per rollup (e.g. Redis SET NX). Return a release function, or `null` when another run holds
   * it (that rollup is then skipped, reported as `busy`). Independent of this, each (tenant, rollup) step takes a
   * transaction-level advisory lock, so even without it two overlapping runs never aggregate the same slice twice.
   */
  runLock?: (rollup: string) => Promise<null | (() => Promise<void>)>;
}

export interface RollupRunReport {
  table: string; rollup: string; tenantId: string;
  /** Transactions that aggregated something (fresh window, dirty range or sweep). */
  slices: number;
  /** Rollup rows inserted or actually changed (unchanged buckets are not rewritten). */
  rows: number;
  from: string | null; to: string | null; error?: string;
  /** `'raw'` or the name of the finer rollup the buckets were derived from. */
  source: string;
  /** Watermark after the run, null while the tenant has no state yet. */
  watermark: string | null;
  /** Newest closed bucket edge at the start of the run. */
  closedEdge: string | null;
  /** Buckets between the watermark and the newest closed edge after the run (0 = caught up); null without state. */
  lagBuckets: number | null;
  lagMs: number | null;
  /** Dirty-range hints still queued. */
  dirtyPending: number;
  /** Work remains (slice, time or lock budget exhausted); it resumes on the next run. */
  truncated: boolean;
  /** Skipped because another run holds the lock for this rollup or tenant. */
  busy: boolean;
  dirtyRanges: number; sweeps: number;
}

const asDate = (v: unknown): Date | null => (v == null ? null : new Date(v as string | number | Date));
const binDown = (ms: number, bucketMs: number): number => Math.floor(ms / bucketMs) * bucketMs;
const binUp = (ms: number, bucketMs: number): number => Math.ceil(ms / bucketMs) * bucketMs;

interface Ctx {
  t: TimeSeriesTable; r: RollupDecl; src: RollupDecl | null; children: RollupDecl[]; tenantId: string; now: number;
}

interface StepResult {
  kind: 'fresh' | 'dirty' | 'sweep' | 'idle' | 'busy';
  rows: number; from?: number; to?: number; more: boolean;
  watermark: number | null; closedEdge: number; dirtyPending: number;
}

/** One idempotent upsert of the buckets in [from, to) from raw rows or from the finer rollup. Only inserted/changed rows are written. */
async function aggregateWindow(
  db: SqlRunner, c: Ctx, from: number, to: number, viaSource: boolean,
): Promise<{ n: number; lo: Date | null; hi: Date | null }> {
  const { t, r, tenantId } = c;
  const tenant = qi(rollupTenantColumn(t));
  const groups = (r.groupBy ?? []).map(qi);
  const outs = outputColumns(r);
  const target = [tenant, ...groups, '"bucket"', ...outs.map((o) => qi(o.name))];
  const keyCols = [tenant, ...groups, '"bucket"'];
  let select: string[]; let fromSql: string;
  if (viaSource && c.src) {
    const src = c.src;
    select = [`$1::uuid`, ...groups, `date_bin($2::interval, "bucket", ${ORIGIN}) AS "bucket"`,
      ...outs.map((o) => derivedAggSql(src, o.col, o.agg))];
    // GROUP BY the output position, not the name: "bucket" is also the source's input column and would win the name lookup.
    fromSql = `FROM ${await accessRel(db, src.name)} WHERE ${tenant} = $1 AND "bucket" >= $3 AND "bucket" < $4`;
  } else {
    select = [`$1::uuid`, ...groups, `date_bin($2::interval, ${qi(t.timeColumn)}, ${ORIGIN}) AS "bucket"`,
      ...outs.map((o) => aggSql(o.col, o.agg, t.timeColumn))];
    fromSql = `FROM ${await accessRel(db, t.table)} WHERE ${tenant} = $1 AND ${qi(t.timeColumn)} >= $3 AND ${qi(t.timeColumn)} < $4${groups.map((g) => ` AND ${g} IS NOT NULL`).join('')}`;
  }
  const tbl = await accessRel(db, r.name);
  const changed = `ROW(${outs.map((o) => `${tbl}.${qi(o.name)}`).join(', ')}) IS DISTINCT FROM ROW(${outs.map((o) => `EXCLUDED.${qi(o.name)}`).join(', ')})`;
  // CTE + count: TypeORM returns no row count for a plain INSERT.
  const sql =
    `WITH up AS (INSERT INTO ${tbl} (${target.join(', ')})
     SELECT ${select.join(', ')} ${fromSql}
      GROUP BY ${[...groups, viaSource ? String(groups.length + 2) : '"bucket"'].join(', ')}
     ON CONFLICT (${keyCols.join(', ')}) DO UPDATE SET ${outs.map((o) => `${qi(o.name)} = EXCLUDED.${qi(o.name)}`).join(', ')}
       WHERE ${changed}
     RETURNING "bucket") SELECT count(*)::int AS n, min("bucket") AS lo, max("bucket") AS hi FROM up`;
  const res = rowsOf<{ n: number; lo: unknown; hi: unknown }>(await db.query(sql, [tenantId, r.bucket, new Date(from), new Date(to)]))[0];
  const n = Number(res?.n ?? 0);
  const lo = asDate(res?.lo); const hi = asDate(res?.hi);
  // Dependent rollups redo exactly the parent buckets that contain a changed bucket - but only the part the child has
  // already closed (its watermark is above the range start); at/after its watermark the child's fresh window reads the
  // new values anyway. The child's own step clips again under its own lock.
  if (n > 0 && lo && hi) {
    for (const child of c.children) {
      await insertDirty(db, child.name, tenantId, child.bucket, lo, hi, true);
    }
  }
  return { n, lo, hi };
}

async function insertDirty(
  db: SqlRunner, rollup: string, tenantId: string, bucket: RollupBucket, lo: Date, hi: Date, onlyIfClosed = false,
): Promise<void> {
  const range = `date_bin($3::interval, $4::timestamptz, ${ORIGIN}), date_bin($3::interval, $5::timestamptz, ${ORIGIN}) + $3::interval`;
  await db.query(
    onlyIfClosed
      ? `INSERT INTO ${qi(ROLLUP_DIRTY_TABLE)} ("rollup", "tenantId", "dirtyFrom", "dirtyTo")
         SELECT $1::varchar, $2::uuid, ${range} WHERE EXISTS (SELECT 1 FROM ${qi(ROLLUP_STATE_TABLE)} WHERE "rollup" = $1 AND "tenantId" = $2
           AND "watermark" > date_bin($3::interval, $4::timestamptz, ${ORIGIN}))`
      : `INSERT INTO ${qi(ROLLUP_DIRTY_TABLE)} ("rollup", "tenantId", "dirtyFrom", "dirtyTo") VALUES ($1::varchar, $2::uuid, ${range})`,
    [rollup, tenantId, bucket, lo, hi],
  );
}

const setWatermark = (db: SqlRunner, rollup: string, tenantId: string, to: number, sweptAt: Date | null) => db.query(
  `INSERT INTO ${qi(ROLLUP_STATE_TABLE)} ("rollup", "tenantId", "watermark", "lastSweepAt") VALUES ($1, $2, $3, $4)
   ON CONFLICT ("rollup", "tenantId") DO UPDATE
     SET "watermark" = GREATEST(${qi(ROLLUP_STATE_TABLE)}."watermark", EXCLUDED."watermark"),
         "lastSweepAt" = COALESCE(EXCLUDED."lastSweepAt", ${qi(ROLLUP_STATE_TABLE)}."lastSweepAt"), "updatedAt" = now()`,
  [rollup, tenantId, new Date(to), sweptAt],
);

/**
 * One transaction of work for one (tenant, rollup), chosen in this order: the next slice of the fresh window
 * [watermark, newest closed edge) (cost proportional to NEW data), then the next merged dirty range queued by
 * `markRollupDirty` / by a finer rollup that changed (cost proportional to the late rows), then - at most every
 * `sweepEvery` - the safety-net sweep of the late window. Everything runs inside the caller's tenant scope; the
 * (rollup, tenant) advisory lock makes an overlapping run skip instead of duplicate.
 */
async function step(db: SqlRunner, c: Ctx): Promise<StepResult> {
  const { t, r, src, tenantId } = c;
  const B = BUCKET_MS[r.bucket];
  const closedEdge = binDown(c.now - intervalMs(r.lag ?? DEFAULT_LAG), B);
  const none = (kind: StepResult['kind'], wm: number | null, dirtyPending = 0): StepResult =>
    ({ kind, rows: 0, more: false, watermark: wm, closedEdge, dirtyPending });

  const locked = rowsOf<{ ok: boolean }>(await db.query(`SELECT pg_try_advisory_xact_lock(hashtext($1), hashtext($2)) AS ok`, [r.name, tenantId]))[0];
  if (!locked?.ok) return none('busy', null);

  const st = rowsOf<{ wm: unknown; swept: unknown }>(await db.query(
    `SELECT "watermark" AS wm, "lastSweepAt" AS swept FROM ${qi(ROLLUP_STATE_TABLE)} WHERE "rollup" = $1 AND "tenantId" = $2`, [r.name, tenantId],
  ))[0];
  const wmDate = asDate(st?.wm);
  const rawFloor = t.retention ? binUp(c.now - intervalMs(t.retention), B) : -Infinity;
  const srcFloor = src?.retention ? binUp(c.now - intervalMs(src.retention), B) : -Infinity;
  const span = SLICE_MS[r.bucket];
  const hasSrc = src !== null;

  /** Mode for a window starting at `from`: derive from the finer rollup while its rows still exist, raw otherwise. */
  const modeFor = (from: number): { viaSource: boolean; cap: number } =>
    hasSrc && from >= srcFloor ? { viaSource: true, cap: Infinity } : { viaSource: false, cap: hasSrc && srcFloor > from ? srcFloor : Infinity };

  // ── 1. fresh window ──
  let start: number;
  if (wmDate) start = wmDate.getTime();
  else {
    // First run for this tenant: backfill from its oldest raw row.
    const tenantCol = qi(rollupTenantColumn(t));
    const first = asDate(rowsOf<{ first: unknown }>(await db.query(
      `SELECT min(${qi(t.timeColumn)}) AS first FROM ${await accessRel(db, t.table)} WHERE ${tenantCol} = $1`, [tenantId],
    ))[0]?.first);
    if (!first) return none('idle', null);
    start = binDown(first.getTime(), B);
  }
  let freshTo = closedEdge;
  // A derived rollup backfills from its source too (interleaved with it: it waits for the source watermark) wherever the
  // source still has rows; older history comes from raw rows. Only a rollup without a source reads raw all the way.
  const freshMode = modeFor(start);
  const fromFresh = freshMode.viaSource ? start : Math.max(start, rawFloor);
  if (freshMode.viaSource && src) {
    const swm = asDate(rowsOf<{ wm: unknown }>(await db.query(
      `SELECT "watermark" AS wm FROM ${qi(ROLLUP_STATE_TABLE)} WHERE "rollup" = $1 AND "tenantId" = $2`, [src.name, tenantId],
    ))[0]?.wm);
    freshTo = Math.min(freshTo, swm ? binDown(swm.getTime(), B) : -Infinity);
  }
  if (fromFresh < freshTo) {
    const end = Math.min(freshTo, fromFresh + span, freshMode.cap);
    const out = await aggregateWindow(db, c, fromFresh, end, freshMode.viaSource);
    await setWatermark(db, r.name, tenantId, end, null);
    return { kind: 'fresh', rows: out.n, from: fromFresh, to: end, more: end < freshTo, watermark: Math.max(end, wmDate?.getTime() ?? end), closedEdge, dirtyPending: 0 };
  }
  if (!wmDate) return none('idle', null);
  const wm = wmDate.getTime();

  // ── 2. dirty ranges ──
  const hints = rowsOf<{ id: string; f: unknown; t: unknown }>(await db.query(
    `SELECT "id", "dirtyFrom" AS f, "dirtyTo" AS t FROM ${qi(ROLLUP_DIRTY_TABLE)} WHERE "rollup" = $1 AND "tenantId" = $2 ORDER BY "dirtyFrom" LIMIT 500`,
    [r.name, tenantId],
  ));
  if (hints.length > 0) {
    // Clip to what can be recomputed ([raw floor, watermark)); the part at/after the watermark is the fresh window's job.
    const lower = hasSrc ? Math.min(rawFloor, srcFloor) : rawFloor;
    const live: { id: string; a: number; b: number }[] = [];
    const dead: string[] = [];
    for (const h of hints) {
      const a = Math.max(asDate(h.f)!.getTime(), lower);
      const b = Math.min(asDate(h.t)!.getTime(), wm);
      if (a < b) live.push({ id: h.id, a, b }); else dead.push(h.id);
    }
    if (live.length === 0) {
      await db.query(`DELETE FROM ${qi(ROLLUP_DIRTY_TABLE)} WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[])`, [tenantId, dead]);
    } else {
      // The first merged group (overlapping or touching ranges) is this transaction's job.
      const ids = [live[0].id]; const gStart = live[0].a; let gEnd = live[0].b;
      for (const h of live.slice(1)) { if (h.a > gEnd) break; ids.push(h.id); gEnd = Math.max(gEnd, h.b); }
      const mode = modeFor(gStart);
      const end = Math.min(gEnd, gStart + span, mode.cap);
      const out = await aggregateWindow(db, c, gStart, end, mode.viaSource);
      await db.query(`DELETE FROM ${qi(ROLLUP_DIRTY_TABLE)} WHERE "tenantId" = $1 AND "id" = ANY($2::uuid[])`, [tenantId, [...ids, ...dead]]);
      if (end < gEnd) await insertDirty(db, r.name, tenantId, r.bucket, new Date(end), new Date(gEnd - 1));
      const pending = hints.length - ids.length - dead.length + (end < gEnd ? 1 : 0);
      return { kind: 'dirty', rows: out.n, from: gStart, to: end, more: pending > 0 || hints.length === 500, watermark: wm, closedEdge, dirtyPending: pending };
    }
  }

  // ── 3. safety-net sweep (rollups aggregated from raw only; a derived rollup follows its source) ──
  const late = Math.min(intervalMs(r.lateWindow ?? DEFAULT_LATE[r.bucket]), span);
  const sweepEvery = intervalMs(r.sweepEvery ?? DEFAULT_SWEEP[r.bucket]);
  const swept = asDate(st?.swept);
  if (!hasSrc && late > 0 && (!swept || c.now - swept.getTime() >= sweepEvery)) {
    const from = Math.max(binDown(wm - late, B), rawFloor);
    let rows = 0;
    if (from < wm) rows = (await aggregateWindow(db, c, from, wm, false)).n;
    await setWatermark(db, r.name, tenantId, wm, new Date(c.now));
    return { kind: 'sweep', rows, from, to: wm, more: false, watermark: wm, closedEdge, dirtyPending: 0 };
  }
  return none('idle', wm);
}

/** Pure: lag of a watermark behind the newest closed edge, in buckets. */
export function rollupLag(bucket: RollupBucket, watermarkMs: number | null, closedEdgeMs: number): { lagBuckets: number | null; lagMs: number | null } {
  if (watermarkMs === null) return { lagBuckets: null, lagMs: null };
  const lagMs = Math.max(0, closedEdgeMs - watermarkMs);
  return { lagBuckets: Math.round(lagMs / BUCKET_MS[bucket]), lagMs };
}

/** Aggregate view of a run for the job summary / dashboards. */
export function summarizeRollupReports(reports: RollupRunReport[]): { maxLagBuckets: number; maxLagMs: number; truncated: number; busy: number } {
  let maxLagBuckets = 0; let maxLagMs = 0; let truncated = 0; let busy = 0;
  for (const r of reports) {
    if (r.lagBuckets !== null) maxLagBuckets = Math.max(maxLagBuckets, r.lagBuckets);
    if (r.lagMs !== null) maxLagMs = Math.max(maxLagMs, r.lagMs);
    if (r.truncated) truncated += 1;
    if (r.busy) busy += 1;
  }
  return { maxLagBuckets, maxLagMs, truncated, busy };
}

/**
 * Ingest hint: rows with timestamps between `minTs` and `maxTs` were just written for `tenantId`, call it in the SAME
 * tenant transaction as the insert. Only rows that are already (or about to be) behind a rollup's closing edge matter:
 * for those a dirty range is queued for every rollup aggregated from raw (finer-to-coarser rollups follow through
 * propagation) and the next pass re-aggregates just those buckets. Fresh rows (the common case) cost nothing - the
 * watermark picks them up. Insert-only and unconditional (it never reads or locks the watermark), so ingest is never
 * blocked by the job and a hint committed together with its rows cannot be lost. Returns the number of hints written.
 */
export async function markRollupDirty(
  db: SqlRunner, t: TimeSeriesTable, tenantId: string, minTs: Date, maxTs: Date = minTs, now: Date = new Date(),
): Promise<number> {
  let n = 0;
  for (const r of t.rollups ?? []) {
    if (rollupSource(t, r) !== null) continue;
    const edge = now.getTime() - intervalMs(r.lag ?? DEFAULT_LAG) + ROLLUP_HINT_SLACK_MS;
    if (minTs.getTime() >= edge) continue;
    await insertDirty(db, r.name, tenantId, r.bucket, minTs, maxTs);
    n += 1;
  }
  return n;
}

interface Task {
  c: Ctx; rep: RollupRunReport; done: boolean; last: StepResult | null;
  /** Finished for this run for good (error, busy, budget): never reactivated by a parent's change. */
  hard?: boolean;
}

/**
 * Incrementally maintain every declared rollup, tenant by tenant. Every statement runs inside `scope(tenantId, ...)` so
 * RLS applies and a bug can at worst write the wrong tenant's own rows, never mix tenants. A tenant (or rollup) that
 * fails is reported and does not stop the others.
 *
 * Work is driven by what changed, not by a re-scan of a late window: new closed buckets since the watermark, buckets
 * that received late rows (queued by `markRollupDirty`, or by a finer rollup whose bucket changed), and a periodic
 * safety-net sweep that rewrites only buckets whose values differ. Coarser rollups are derived from finer ones when
 * the declared aggregates allow it (`rollupSource`). Rounds are fair: every (tenant, rollup) gets one transaction before
 * anyone gets a second, so a long backfill cannot starve the others; `maxRunMs` / `maxSlicesPerRun` bound the run and
 * the remainder resumes on the next one (state is committed per transaction).
 *
 * Idempotent: the upsert replaces whole buckets with values recomputed from the source, the watermark only moves
 * forward, dirty hints are deleted in the transaction that recomputed them.
 */
export async function runTimeSeriesRollups(tables: TimeSeriesTable[], opts: RollupRunOptions): Promise<RollupRunReport[]> {
  const nowMs = (opts.now ?? new Date()).getTime();
  const startedAt = Date.now();
  const maxSlices = opts.maxSlicesPerRun ?? DEFAULT_MAX_SLICES;
  const withRollups = tables.filter((t) => (t.rollups?.length ?? 0) > 0);
  if (withRollups.length === 0) return [];
  const all = await opts.tenants();
  // Rotate the start so a run cut short by the budget does not always starve the same tenants.
  const rot = all.length > 0 ? Math.floor(nowMs / 60_000) % all.length : 0;
  const tenants = [...all.slice(rot), ...all.slice(0, rot)];

  const releases: (() => Promise<void>)[] = [];
  const locked = new Set<string>();
  const tasks: Task[] = [];
  for (const t of withRollups) {
    for (const r of t.rollups ?? []) {
      if (opts.runLock) {
        const release = await opts.runLock(r.name).catch(() => null);
        if (!release) locked.add(r.name); else releases.push(release);
      }
    }
  }
  for (const tenantId of tenants) {
    for (const t of withRollups) {
      for (const r of [...(t.rollups ?? [])].sort((a, b) => BUCKET_MS[a.bucket] - BUCKET_MS[b.bucket])) {
        const src = rollupSource(t, r);
        const children = (t.rollups ?? []).filter((x) => rollupSource(t, x)?.name === r.name);
        const rep: RollupRunReport = {
          table: t.table, rollup: r.name, tenantId, slices: 0, rows: 0, from: null, to: null, source: src?.name ?? 'raw',
          watermark: null, closedEdge: null, lagBuckets: null, lagMs: null, dirtyPending: 0, truncated: false, busy: locked.has(r.name),
          dirtyRanges: 0, sweeps: 0,
        };
        tasks.push({ c: { t, r, src, children, tenantId, now: nowMs }, rep, done: locked.has(r.name), last: null });
      }
    }
  }

  try {
    const outOfTime = () => opts.maxRunMs !== undefined && Date.now() - startedAt >= opts.maxRunMs;
    for (let progressed = true; progressed;) {
      progressed = false;
      for (const task of tasks) {
        if (task.done) continue;
        const { c, rep } = task;
        if (outOfTime()) { task.done = true; task.hard = true; rep.truncated = true; continue; }
        if (rep.slices >= maxSlices) { task.done = true; task.hard = true; rep.truncated = task.last?.more ?? true; continue; }
        try {
          const res = await opts.scope(c.tenantId, (db) => step(db, c));
          task.last = res;
          rep.closedEdge = new Date(res.closedEdge).toISOString();
          rep.dirtyPending = res.dirtyPending;
          if (res.watermark !== null) rep.watermark = new Date(res.watermark).toISOString();
          if (res.kind === 'busy') { rep.busy = true; task.done = true; task.hard = true; continue; }
          if (res.kind === 'idle') { task.done = true; continue; }
          progressed = true;
          rep.slices += 1; rep.rows += res.rows;
          // A changed bucket queued dirty ranges for the dependent rollups of this tenant: wake those that already finished.
          if (res.rows > 0) for (const o of tasks) if (o.done && !o.hard && o.c.tenantId === c.tenantId && o.c.src?.name === c.r.name && o.c.t === c.t) o.done = false;
          if (res.kind === 'dirty') rep.dirtyRanges += 1;
          if (res.kind === 'sweep') rep.sweeps += 1;
          if (res.from !== undefined && res.to !== undefined) {
            const f = new Date(res.from).toISOString(); const e = new Date(res.to).toISOString();
            if (!rep.from || f < rep.from) rep.from = f;
            if (!rep.to || e > rep.to) rep.to = e;
          }
          if (!res.more && res.kind !== 'fresh' && res.kind !== 'dirty') task.done = true;
        } catch (err) {
          rep.error = err instanceof Error ? err.message : String(err);
          task.done = true; task.hard = true;
          Logger.warn(`[time-series-rollup] ${c.r.name} tenant ${c.tenantId} failed: ${rep.error}`);
        }
      }
    }
  } finally {
    for (const release of releases) await release().catch(() => undefined);
  }

  const reports: RollupRunReport[] = [];
  for (const task of tasks) {
    const { rep, c } = task;
    if (rep.slices >= maxSlices && task.last?.more) rep.truncated = true;
    if (task.last && task.last.watermark !== null) {
      const lag = rollupLag(c.r.bucket, task.last.watermark, task.last.closedEdge);
      rep.lagBuckets = lag.lagBuckets; rep.lagMs = lag.lagMs;
    }
    reports.push(rep);
  }
  if (opts.onLag) {
    for (const task of tasks) {
      const { rep, c } = task;
      const threshold = c.r.maxLagBuckets ?? opts.lagAlertBuckets ?? DEFAULT_MAX_LAG_BUCKETS;
      if (rep.lagBuckets !== null && rep.lagBuckets > threshold) {
        try {
          await opts.onLag({
            table: rep.table, rollup: rep.rollup, tenantId: rep.tenantId, lagBuckets: rep.lagBuckets, lagMs: rep.lagMs ?? 0, threshold,
            watermark: rep.watermark, closedEdge: rep.closedEdge, truncated: rep.truncated, error: rep.error,
          });
        } catch (err) {
          Logger.warn(`[time-series-rollup] lag hook failed for ${rep.rollup}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }
  }
  return reports;
}

// ─── the read helper ────────────────────────────────────────────────────────

export interface SeriesRequest {
  from: Date;
  to: Date;
  /** Finest acceptable bucket in ms. Default: (to - from) / maxPoints. */
  resolutionMs?: number;
  /** Used when `resolutionMs` is absent. Default 500. */
  maxPoints?: number;
  /** Equality filters on rollup `groupBy` columns, e.g. `{ deviceId, key }`. */
  filters?: Record<string, string | number | boolean>;
  now?: Date;
}

export interface SeriesSource {
  kind: 'raw' | 'rollup';
  /** Table the bulk of the window is read from. */
  name: string;
  /** 0 for raw. */
  bucketMs: number;
  rollup?: RollupDecl;
}

/**
 * Pick the coarsest source that still satisfies the requested resolution and
 * whose retention covers the start of the window: raw -> 1m -> 1h -> 1d.
 * Pure; `readTimeSeries` runs the choice.
 */
export function pickSeriesSource(t: TimeSeriesTable, req: SeriesRequest): SeriesSource {
  const now = (req.now ?? new Date()).getTime();
  const span = Math.max(0, req.to.getTime() - req.from.getTime());
  const wanted = req.resolutionMs ?? Math.ceil(span / Math.max(1, req.maxPoints ?? 500));
  const candidates = [...(t.rollups ?? [])]
    .filter((r) => r.bucket in BUCKET_MS)
    .sort((a, b) => BUCKET_MS[b.bucket] - BUCKET_MS[a.bucket]);
  for (const r of candidates) {
    if (BUCKET_MS[r.bucket] > wanted) continue;
    if (r.retention && now - req.from.getTime() > intervalMs(r.retention)) continue;
    return { kind: 'rollup', name: r.name, bucketMs: BUCKET_MS[r.bucket], rollup: r };
  }
  return { kind: 'raw', name: t.table, bucketMs: 0 };
}

/**
 * Tenant-scoped read at an automatically chosen resolution. Rows have the
 * `groupBy` columns, `bucket` and every `<column>_<aggregate>` of the picked
 * rollup. For a rollup read, buckets the job has not materialised yet (the
 * live tail after the watermark) are aggregated from raw rows on the fly, so
 * the answer is complete. For raw (finer than any rollup) each row is its own
 * bucket and every aggregate equals the value (count 1), in the shape of the
 * finest rollup. Runs in `scope(tenantId, ...)` so RLS applies.
 */
export async function readTimeSeries(
  t: TimeSeriesTable, tenantId: string, req: SeriesRequest,
  scope?: <T>(tenantId: string, fn: (db: SqlRunner) => Promise<T>) => Promise<T>,
): Promise<{ source: SeriesSource; rows: Record<string, unknown>[] }> {
  const rollups = t.rollups ?? [];
  if (rollups.length === 0) throw new Error(`[time-series] ${t.table} declares no rollups`);
  const source = pickSeriesSource(t, req);
  const shape = source.rollup ?? [...rollups].sort((a, b) => BUCKET_MS[a.bucket] - BUCKET_MS[b.bucket])[0];
  const tenant = qi(rollupTenantColumn(t));
  const groups = (shape.groupBy ?? []).map(qi);
  const outs = outputColumns(shape);
  const filterKeys = Object.keys(req.filters ?? {});
  for (const k of filterKeys) if (!(shape.groupBy ?? []).includes(k)) throw new Error(`[time-series] filter "${k}" is not a groupBy column of ${shape.name}`);
  const run = scope ?? (async <T>(id: string, fn: (db: SqlRunner) => Promise<T>) => {
    const { withTenantTransactionFor } = await import('./db.context');
    return withTenantTransactionFor(id, (qr) => fn(qr));
  });
  const now = req.now ?? new Date();
  const filterSql = (start: number) => filterKeys.map((k, i) => ` AND ${qi(k)} = $${start + i}`).join('');
  const filterVals = filterKeys.map((k) => (req.filters as Record<string, unknown>)[k]);

  if (source.kind === 'raw') {
    const cols = [...groups, `${qi(t.timeColumn)} AS "bucket"`, ...outs.map((o) => `${o.agg === 'count' ? '1::bigint' : `${qi(o.col)}::double precision`} AS ${qi(o.name)}`)];
    const rows = await run(tenantId, async (db) => rowsOf<Record<string, unknown>>(await db.query(
      `SELECT ${cols.join(', ')} FROM ${await accessRel(db, t.table)} WHERE ${tenant} = $1 AND ${qi(t.timeColumn)} >= $2 AND ${qi(t.timeColumn)} < $3${filterSql(4)} ORDER BY ${qi(t.timeColumn)}`,
      [tenantId, req.from, req.to, ...filterVals],
    )));
    return { source, rows };
  }

  const r = shape;
  // Cutoff between stored buckets and the raw tail: the watermark, capped at the newest closed bucket.
  const cutoff = `LEAST(date_bin($4::interval, $5::timestamptz - $6::interval, ${ORIGIN}),
                        COALESCE((SELECT "watermark" FROM ${qi(ROLLUP_STATE_TABLE)} WHERE "rollup" = $7 AND "tenantId" = $1), '-infinity'::timestamptz))`;
  const fSql = filterSql(8);
  const stored = [...groups, '"bucket"', ...outs.map((o) => qi(o.name))];
  const tail = [...groups, `date_bin($4::interval, ${qi(t.timeColumn)}, ${ORIGIN}) AS "bucket"`, ...outs.map((o) => `${aggSql(o.col, o.agg, t.timeColumn)} AS ${qi(o.name)}`)];
  const sqlFor = (rawRel: string, rollRel: string) =>
    `WITH c AS (SELECT ${cutoff} AS cutoff)
     SELECT * FROM (
       SELECT ${stored.join(', ')} FROM ${rollRel}, c
        WHERE ${tenant} = $1 AND "bucket" >= date_bin($4::interval, $2::timestamptz, ${ORIGIN}) AND "bucket" < LEAST(c.cutoff, $3::timestamptz)${fSql}
       UNION ALL
       SELECT ${tail.join(', ')} FROM ${rawRel}, c
        WHERE ${tenant} = $1 AND ${qi(t.timeColumn)} >= GREATEST(c.cutoff, date_bin($4::interval, $2::timestamptz, ${ORIGIN})) AND ${qi(t.timeColumn)} < $3${fSql}
        GROUP BY ${[...groups, String(groups.length + 1)].join(', ')}
     ) u ORDER BY "bucket"`;
  const rows = await run(tenantId, async (db) => rowsOf<Record<string, unknown>>(await db.query(
    sqlFor(await accessRel(db, t.table), await accessRel(db, r.name)), [tenantId, req.from, req.to, r.bucket, now, r.lag ?? DEFAULT_LAG, r.name, ...filterVals],
  )));
  return { source, rows };
}
