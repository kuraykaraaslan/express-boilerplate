import Logger from '@kuraykaraaslan-labs/logger';
import {
  rowsOf, timescaleCapability, type SqlRunner, type TimescaleCapability,
} from './db.timescale';
import {
  accessRel, accessViewName, ensureRollupState, ensureRollupTable, keyColumnsOf, rollupAsTable, validateRollups, type RollupDecl,
} from './db.time-series.rollup';

export type { RollupDecl, RollupAggregate, RollupBucket } from './db.time-series.rollup';
export { accessRel as timeSeriesAccessRel, accessViewName } from './db.time-series.rollup';

/**
 * Time-series tables as a platform capability (docs/phases/10-db phase 5 §5.3-5.5).
 *
 * A module declares "this append-only, time-keyed table should be a hypertable
 * with a retention window" by exporting `TIME_SERIES_TABLES` from a
 * `*.timeseries.ts` file and contributing it to the `db:time_series` point
 * (`db` never imports the owner - the `tenant_export:collection` inversion).
 *
 *  - Timescale: hypertable + chunk-drop retention (+ optional compression and
 *    continuous aggregates on the TSL edition).
 *  - Anything else: a plain table with a BRIN time index, a
 *    `(tenantId, time DESC)` btree and batched-delete retention.
 *
 * Tenant isolation (RLS + the Faz 2 chokepoint) is identical in both modes: RLS
 * policies are generated from ENTITIES like any tenant table, and chunks are
 * reached only through the parent hypertable.
 */

export interface ContinuousAggregateDecl {
  /** View name (unquoted identifier). */
  view: string;
  /** The aggregate query, e.g. `SELECT time_bucket('1 hour', "at") AS bucket, ... GROUP BY bucket, ...`. */
  query: string;
  /** Bucket width (documentation + refresh window), e.g. `1 hour`. */
  bucket: string;
  /** How far behind now the refresh policy stops, e.g. `1 hour`. */
  refreshLag: string;
  retention?: string;
}

export interface TimeSeriesTable {
  table: string;
  timeColumn: string;
  /** Postgres interval, e.g. `1 day`. */
  chunkInterval: string;
  /** Postgres interval; rows older than this are dropped. */
  retention?: string;
  /** Interval after which chunks are compressed (TSL only). */
  compressAfter?: string;
  segmentBy?: string[];
  /** Column holding the tenant (default `tenantId`); `null` = not tenant scoped. */
  tenantColumn?: string | null;
  /**
   * TSL only, for tables WITHOUT row-level security (system tables). A tenant-scoped
   * (RLS) table is refused: use `rollups`, which are tenant-isolated tables.
   */
  continuousAggregates?: ContinuousAggregateDecl[];
  /**
   * Pre-aggregated, tenant-isolated rollup tables for a tenant-scoped table (ordinary
   * (hyper)tables with tenantId + the same RLS/FORCE, filled by the rollup job; see
   * db.time-series.rollup.ts). The answer to "RLS tables cannot be compressed or be a
   * continuous aggregate source".
   */
  rollups?: RollupDecl[];
}

export const TIME_SERIES_POINT = 'db:time_series';

/**
 * Non-superuser role (no usable login, see ensureOwnerRole) that owns every tenant-scoped hypertable (and so its chunks). Superusers bypass RLS even
 * with FORCE, and chunks copy the hypertable's privileges without inheriting its RLS, so the app roles get NO
 * privileges on the hypertable and reach it only through the owner-owned `<table>_v` view (phase-5 section 5.8).
 */
export const DEFAULT_TIMESERIES_OWNER = 'tele_owner';
export const timeSeriesOwnerRole = (raw: string | undefined = process.env.DB_TIMESERIES_OWNER_ROLE): string => {
  const r = raw?.trim() || DEFAULT_TIMESERIES_OWNER;
  if (!/^[a-z_][a-z0-9_]*$/.test(r)) throw new Error(`[time-series] unsafe owner role name "${r}"`);
  return r;
};
const APP_ROLES = ['app_runtime', 'app_admin'] as const;
export const DROP_CHUNKS_FN = 'time_series_drop_chunks';

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const INTERVAL = /^\d+\s+(second|minute|hour|day|week|month|year)s?$/i;

export const q = (ident: string): string => {
  if (!IDENT.test(ident)) throw new Error(`[time-series] unsafe identifier "${ident}"`);
  return `"${ident}"`;
};

/** Pure declaration checks (identifiers, intervals, duplicates). Returns the problems. */
export function validateTimeSeriesTables(tables: TimeSeriesTable[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  const names = new Set<string>(tables.map((t) => t.table));
  for (const t of tables) {
    const where = `time-series table "${t.table}"`;
    for (const [label, value] of [['table', t.table], ['timeColumn', t.timeColumn]] as const) {
      if (!IDENT.test(value ?? '')) problems.push(`${where}: ${label} must be a plain identifier`);
    }
    if (seen.has(t.table)) problems.push(`${where}: declared twice`);
    seen.add(t.table);
    for (const [label, value] of [
      ['chunkInterval', t.chunkInterval], ['retention', t.retention], ['compressAfter', t.compressAfter],
    ] as const) {
      if (value !== undefined && !INTERVAL.test(value)) problems.push(`${where}: ${label} "${value}" is not "<n> <unit>"`);
      // db.07: a zero interval is not a setting: a zero retention deletes every row at the first sweep.
      else if (value !== undefined && /^\s*0+\s/.test(value)) problems.push(`${where}: ${label} "${value}" must be greater than zero`);
    }
    if (t.compressAfter && t.retention && toDays(t.compressAfter) >= toDays(t.retention)) {
      problems.push(`${where}: compressAfter must be shorter than retention`);
    }
    problems.push(...validateRollups(t, names));
    for (const c of t.segmentBy ?? []) if (!IDENT.test(c)) problems.push(`${where}: segmentBy column "${c}" is not an identifier`);
    for (const a of t.continuousAggregates ?? []) {
      if (!IDENT.test(a.view)) problems.push(`${where}: aggregate view "${a.view}" is not an identifier`);
      for (const [label, value] of [['bucket', a.bucket], ['refreshLag', a.refreshLag], ['retention', a.retention]] as const) {
        if (value !== undefined && !INTERVAL.test(value)) problems.push(`${where}: aggregate ${a.view} ${label} "${value}" is not "<n> <unit>"`);
      }
    }
  }
  return problems;
}

const UNIT_DAYS: Record<string, number> = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365 };
function toDays(interval: string): number {
  const m = interval.trim().match(/^(\d+)\s+([a-z]+?)s?$/i);
  return m ? Number(m[1]) * (UNIT_DAYS[m[2].toLowerCase()] ?? 1) : 0;
}

/**
 * Entity rules the declaration depends on, as `ds.getMetadata`-shaped data so a
 * unit test can pass a fake:
 *
 *  1. Timescale requires every unique index to include the time column.
 *  2. A tenant-scoped table (`tenantColumn` not null) must have the tenant column
 *     FIRST in every unique key (the primary key included), e.g.
 *     `(tenantId, deviceId, keyId, ts)`. A unique index is checked against all rows
 *     regardless of RLS, so a key without the tenant lets tenant X learn from a
 *     23505 error, or from an `ON CONFLICT DO NOTHING` row count, that tenant Y owns
 *     a row at that key (benchmark probes 24/25, docs/concepts/iot-telemetry/phases/09).
 *     With the tenant first the same insert simply succeeds: the keys no longer collide.
 */
export interface EntityShape {
  primaryColumns: string[];
  uniqueIndexes: string[][];
}
export function entityRuleProblems(t: TimeSeriesTable, shape: EntityShape): string[] {
  const problems: string[] = [];
  const tenant = tenantColumnOf(t);
  const keys: { label: string; cols: string[] }[] = [
    { label: 'primary key', cols: shape.primaryColumns },
    ...shape.uniqueIndexes.map((cols) => ({ label: 'unique index', cols })),
  ];
  for (const { label, cols } of keys) {
    const key = `${label} (${cols.join(', ')})`;
    if (!cols.includes(t.timeColumn)) {
      problems.push(`${t.table}: ${key} must include "${t.timeColumn}"`);
    }
    if (tenant && cols[0] !== tenant) {
      problems.push(`${t.table}: ${key} must start with the tenant column "${tenant}" (a key without it lets a unique violation reveal another tenant's row)`);
    }
  }
  return problems;
}

const tenantColumnOf = (t: TimeSeriesTable): string | null => (t.tenantColumn === undefined ? 'tenantId' : t.tenantColumn);

/** The same rules against the LIVE table, read from the catalog (what the deploy phase enforces). */
async function liveKeyProblems(db: SqlRunner, t: TimeSeriesTable): Promise<string[]> {
  const rows = rowsOf<{ pk?: boolean; def?: unknown }>(await db.query(
    `SELECT i.indisprimary AS pk, pg_get_indexdef(i.indexrelid) AS def FROM pg_index i
      WHERE i.indrelid = to_regclass($1) AND i.indisunique`, [q(t.table)],
  )).filter((r) => typeof r.def === 'string');
  const keys = rows.map((r) => ({ pk: r.pk === true, cols: keyColumnsOf(r.def) ?? [] }));
  if (keys.length === 0) return [];
  const primary = keys.find((k) => k.pk) ?? keys[0];
  return entityRuleProblems(t, {
    primaryColumns: primary.cols,
    uniqueIndexes: keys.filter((k) => k !== primary).map((k) => k.cols),
  });
}

export type TimeSeriesAction =
  | 'hypertable' | 'owner' | 'chunk-acl-revoked' | 'access-view' | 'indexes' | 'chunk-interval' | 'retention-policy' | 'compression' | 'continuous-aggregate' | 'skipped-missing-table'
  | `rollup:${string}`;
export interface TimeSeriesReport { table: string; mode: 'timescale' | 'fallback'; actions: TimeSeriesAction[] }

/**
 * Discover every contribution to `db:time_series` through the host runtime. The tables are the schema's, not a tenant's (deploy and the
 * retention / rollup jobs run once for the database), so every installed contribution counts, whatever its module's state for a tenant.
 */
export async function loadTimeSeriesTables(): Promise<TimeSeriesTable[]> {
  const { ext, systemCtx } = await import('@kuraykaraaslan-labs/common/server/extensions/ext');
  const { dbTimeSeriesLoaders } = await import('@kuraykaraaslan-labs/common/server/generated/extensions/db.time_series');
  const { loaded, failed } = await ext.loadAll<TimeSeriesTable[] | { TIME_SERIES_TABLES?: TimeSeriesTable[] }>(
    TIME_SERIES_POINT, systemCtx('time-series tables: database schema, every tenant'), dbTimeSeriesLoaders,
  );
  for (const f of failed) Logger.error(`[time-series] failed to load '${f.contributionId}': ${f.reason}: ${f.message}`);
  const out: TimeSeriesTable[] = [];
  for (const { contribution, impl } of loaded) {
    const tables = Array.isArray(impl) ? impl : impl?.TIME_SERIES_TABLES;
    if (!Array.isArray(tables)) { Logger.error(`[time-series] '${contribution.id}' declares no TIME_SERIES_TABLES array; skipped`); continue; }
    out.push(...tables);
  }
  return out;
}

async function tableExists(db: SqlRunner, table: string): Promise<boolean> {
  return rowsOf<{ r: string | null }>(await db.query(`SELECT to_regclass($1) AS r`, [q(table)]))[0]?.r != null;
}

/**
 * `(tenantId, time DESC)`: serves "everything of one tenant in a window" (benchmark: without it
 * a tenant-wide 1 h window falls back to the lossy BRIN, 17.5 ms -> 911 ms). Needed in BOTH
 * modes: a hypertable is created without default indexes.
 */
async function ensureTenantTimeIndex(db: SqlRunner, t: TimeSeriesTable): Promise<void> {
  const tenant = tenantColumnOf(t);
  if (tenant) {
    await db.query(`CREATE INDEX IF NOT EXISTS ${q(`${t.table}_${tenant}_${t.timeColumn}_idx`)} ON ${q(t.table)} (${q(tenant)}, ${q(t.timeColumn)} DESC)`);
  }
}

async function ensureFallbackIndexes(db: SqlRunner, t: TimeSeriesTable): Promise<void> {
  await db.query(`CREATE INDEX IF NOT EXISTS ${q(`${t.table}_${t.timeColumn}_brin`)} ON ${q(t.table)} USING brin (${q(t.timeColumn)})`);
  await ensureTenantTimeIndex(db, t);
}

async function currentDropAfter(db: SqlRunner, table: string): Promise<string | null> {
  const row = rowsOf<{ drop_after: string | null }>(await db.query(
    `SELECT config->>'drop_after' AS drop_after FROM timescaledb_information.jobs
      WHERE proc_name = 'policy_retention' AND hypertable_name = $1`, [table],
  ))[0];
  return row?.drop_after ?? null;
}

/** Postgres normalises `1 day` to `1 day`, `7 days` to `7 days`; compare through the server. */
async function sameInterval(db: SqlRunner, a: string, b: string): Promise<boolean> {
  return rowsOf<{ eq: boolean }>(await db.query(`SELECT $1::interval = $2::interval AS eq`, [a, b]))[0]?.eq === true;
}

/**
 * Spike result (docs/phases/10-db phase 5 section 5.5, verified on TimescaleDB 2.17.2 and
 * 2.30.2): a hypertable with row-level security CANNOT be compressed
 * ("compression cannot be used on table with row security"; once compression is
 * on, RLS cannot be enabled) and CANNOT be the source of a NEW continuous
 * aggregate. Tenant isolation wins by default: such a declaration is refused
 * loudly instead of silently dropping the isolation boundary. Opting a table out
 * of RLS to gain compression is an owner decision (the chokepoint alone would
 * then isolate it), not something this helper does on its own.
 */
async function assertNoRlsConflict(db: SqlRunner, t: TimeSeriesTable, what: string): Promise<void> {
  const rls = rowsOf<{ on: boolean }>(await db.query(
    `SELECT relrowsecurity AS "on" FROM pg_class WHERE oid = to_regclass($1)`, [q(t.table)],
  ))[0]?.on === true;
  if (rls) {
    throw new Error(
      `[time-series] ${t.table}: ${what} is unavailable on a hypertable with row-level security (TimescaleDB limitation). ` +
      `Declare \`rollups\` instead (tenant-isolated rollup tables, docs/phases/10-db phase-5 section 5.7), ` +
      `or record an owner decision to exempt the table from RLS.`,
    );
  }
}

/** Roles that exist among the app roles (the DO block guards a database that never ran migration 122). */
const revokeFromAppRoles = (relation: string): string =>
  `DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['app_runtime','app_admin'] LOOP
     IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('REVOKE ALL ON %s FROM %I', '${relation.replace(/'/g, "''")}', r); END IF;
   END LOOP; END $$`;

/** Create the owner role (LOGIN but CONNECTION LIMIT 0 and no password, NOBYPASSRLS, CREATE on the schema) and make the deploy role able to act for it. */
async function ensureOwnerRole(db: SqlRunner, owner: string): Promise<void> {
  await db.query(
    `DO $$ BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${owner}') THEN CREATE ROLE "${owner}" LOGIN CONNECTION LIMIT 0 NOSUPERUSER NOBYPASSRLS; END IF;
     END $$`,
  );
  // LOGIN is needed only because Timescale policy jobs (retention/compression) run as the hypertable OWNER in a background
  // worker, and PostgreSQL refuses to start one for a role that cannot log in. CONNECTION LIMIT 0 + no password means no
  // client can ever authenticate as it (background workers are exempt from the limit).
  await db.query(`ALTER ROLE "${owner}" LOGIN CONNECTION LIMIT 0 NOSUPERUSER NOBYPASSRLS`);
  await db.query(`GRANT CREATE, USAGE ON SCHEMA public TO "${owner}"`);
  // A non-superuser deploy role (owner of the database) needs membership to run ALTER ... OWNER / later synchronize.
  await db.query(
    `DO $$ BEGIN
       IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AND NOT pg_has_role(current_user, '${owner}', 'member') THEN
         EXECUTE format('GRANT %I TO %I', '${owner}', current_user);
       END IF;
     END $$`,
  );
}

/**
 * Owner + privilege state of one tenant-scoped hypertable, enforced idempotently (phase-5 section 5.8):
 * owned by the owner role, no privilege for the app roles on the parent or on ANY existing chunk.
 * Existing chunks cannot be re-owned ("operation not supported on chunk tables"), so ownership is fixed BEFORE
 * `create_hypertable` for a table that is not one yet; for an existing hypertable the ACL clean-up is reported.
 */
async function hardenHypertable(db: SqlRunner, cap: TimescaleCapability, table: string, owner: string): Promise<TimeSeriesAction[]> {
  const acts: TimeSeriesAction[] = [];
  const curOwner = rowsOf<{ o: string }>(await db.query(`SELECT pg_get_userbyid(relowner) AS o FROM pg_class WHERE oid = to_regclass($1)`, [q(table)]))[0]?.o;
  if (curOwner !== owner) { await db.query(`ALTER TABLE ${q(table)} OWNER TO "${owner}"`); acts.push('owner'); }
  // Chunks first (to REPORT them): Timescale propagates a REVOKE on the parent to its chunks, so the report must be
  // taken before the parent is touched; the per-chunk REVOKE afterwards is a belt-and-braces no-op in that case.
  const chunks = cap.available ? rowsOf<{ rel: string }>(await db.query(
    `SELECT format('%I.%I', chunk_schema, chunk_name) AS rel FROM timescaledb_information.chunks WHERE hypertable_name = $1`, [table],
  )) : [];
  const dirtyOf = async (rel: string): Promise<boolean> => rowsOf(await db.query(
    `SELECT 1 FROM pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
      WHERE c.oid = $1::regclass AND a.grantee IN (SELECT oid FROM pg_roles WHERE rolname = ANY($2::text[]))`, [rel, [...APP_ROLES]],
  )).length > 0;
  const dirty: string[] = [];
  for (const c of chunks) if (await dirtyOf(c.rel)) dirty.push(c.rel);
  await db.query(revokeFromAppRoles(q(table)));
  for (const rel of dirty) if (await dirtyOf(rel)) await db.query(revokeFromAppRoles(rel));
  if (dirty.length > 0) {
    Logger.warn(`[time-series] ${table}: revoked app-role privileges from ${dirty.length} pre-existing chunk(s)`);
    acts.push('chunk-acl-revoked');
  }
  return acts;
}

/**
 * `<table>_v`: the ONLY relation the app roles can touch. Owned by the owner role, so the underlying access (and its
 * RLS, FORCE on the owner) runs as the owner with the caller's tenant GUC; `security_barrier` keeps caller quals from
 * running before the policy. Auto-updatable, so INSERT / UPDATE / DELETE / INSERT ... ON CONFLICT DO UPDATE work
 * unchanged (verified on TimescaleDB 2.29), and `WITH CHECK OPTION` is belt and braces beside the policy's WITH CHECK.
 */
const dollar = (sql: string): string => `$q$${sql}$q$`;

async function ensureAccessView(db: SqlRunner, table: string, owner: string): Promise<void> {
  const view = q(accessViewName(table));
  const create = (replace: boolean) =>
    `CREATE ${replace ? 'OR REPLACE ' : ''}VIEW ${view} WITH (security_invoker = false, security_barrier = true) AS SELECT * FROM ${q(table)} WHERE true WITH CHECK OPTION`;
  // Replace in place when possible (keeps dependants); a column set that cannot be replaced falls back to drop + create.
  await db.query(
    `DO $v$ BEGIN
       EXECUTE ${dollar(create(true))};
     EXCEPTION WHEN OTHERS THEN
       EXECUTE ${dollar(`DROP VIEW IF EXISTS ${view}`)};
       EXECUTE ${dollar(create(false))};
     END $v$`,
  );
  await db.query(`ALTER VIEW ${view} OWNER TO "${owner}"`);
  await db.query(
    `DO $$ DECLARE r text; BEGIN FOREACH r IN ARRAY ARRAY['app_runtime','app_admin'] LOOP
       IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %s TO %I', '${view.replace(/'/g, "''")}', r); END IF;
     END LOOP; END $$`,
  );
}

/**
 * Retention for app_admin: `drop_chunks` needs ownership of the hypertable, and app_admin (the system DataSource) is
 * not the owner. A SECURITY DEFINER function owned by the owner role, executable by app_admin only, restricted to
 * hypertables the owner role owns, with a pinned search_path, does exactly that one thing.
 */
async function ensureDropChunksFunction(db: SqlRunner, cap: TimescaleCapability, owner: string): Promise<void> {
  const ns = q(cap.schema ?? 'public');
  await db.query(
    `CREATE OR REPLACE FUNCTION ${DROP_CHUNKS_FN}(p_table text, p_older interval) RETURNS void
       LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $f$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pg_class c WHERE c.oid = to_regclass(quote_ident(p_table)) AND pg_get_userbyid(c.relowner) = '${owner}') THEN
         RAISE EXCEPTION 'time_series_drop_chunks: % is not a hypertable owned by ${owner}', p_table;
       END IF;
       PERFORM ${ns}.drop_chunks(to_regclass(quote_ident(p_table)), older_than => p_older);
     END $f$`,
  );
  await db.query(`ALTER FUNCTION ${DROP_CHUNKS_FN}(text, interval) OWNER TO "${owner}"`);
  await db.query(`REVOKE ALL ON FUNCTION ${DROP_CHUNKS_FN}(text, interval) FROM PUBLIC`);
  await db.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_admin') THEN GRANT EXECUTE ON FUNCTION ${DROP_CHUNKS_FN}(text, interval) TO app_admin; END IF; END $$`);
}

async function isHypertable(db: SqlRunner, table: string): Promise<boolean> {
  return rowsOf(await db.query(`SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = $1`, [table])).length > 0;
}

async function ensureHypertable(db: SqlRunner, cap: TimescaleCapability, t: TimeSeriesTable): Promise<TimeSeriesAction[]> {
  const ns = q(cap.schema ?? 'public');
  const actions: TimeSeriesAction[] = [];
  // Tenant-scoped (RLS) tables: owner first, BEFORE the first chunk exists (chunks copy owner and ACL at creation).
  const isolate = tenantColumnOf(t) !== null;
  const owner = timeSeriesOwnerRole();
  if (isolate) {
    await ensureOwnerRole(db, owner);
    if (!(await isHypertable(db, t.table))) actions.push(...await hardenHypertable(db, cap, t.table, owner));
  }
  // Idempotent: `if_not_exists` makes the second deploy a no-op. `migrate_data`
  // converts a populated table; default indexes are off because every index is
  // declared on the entity (synchronize must never see one it did not create).
  await db.query(
    `SELECT ${ns}.create_hypertable($1::regclass, $2, chunk_time_interval => $3::interval,
       if_not_exists => true, create_default_indexes => false, migrate_data => true)`,
    [q(t.table), t.timeColumn, t.chunkInterval],
  );
  actions.push('hypertable');
  // A declaration whose chunk interval changed (telemetry ED-15: sized by the install, or an operator's override) reaches the
  // existing hypertable forward-only: chunks created from now on take the new size, the existing ones keep theirs, nothing moves.
  const currentChunk = rowsOf<{ i: string | null }>(await db.query(
    `SELECT time_interval::text AS i FROM timescaledb_information.dimensions WHERE hypertable_name = $1 AND column_name = $2 AND dimension_number = 1`,
    [t.table, t.timeColumn],
  ))[0]?.i;
  if (currentChunk && !(await sameInterval(db, currentChunk, t.chunkInterval))) {
    await db.query(`SELECT ${ns}.set_chunk_time_interval($1::regclass, $2::interval)`, [q(t.table), t.chunkInterval]);
    actions.push('chunk-interval');
  }
  if (isolate) {
    actions.push(...await hardenHypertable(db, cap, t.table, owner));
    await ensureAccessView(db, t.table, owner);
    await ensureDropChunksFunction(db, cap, owner);
    actions.push('access-view');
  }

  if (cap.edition !== 'tsl') return actions;

  if (t.retention) {
    const existing = await currentDropAfter(db, t.table);
    if (!existing || !(await sameInterval(db, existing, t.retention))) {
      await db.query(`SELECT ${ns}.remove_retention_policy($1::regclass, if_exists => true)`, [q(t.table)]);
      await db.query(`SELECT ${ns}.add_retention_policy($1::regclass, $2::interval, if_not_exists => true)`, [q(t.table), t.retention]);
      actions.push('retention-policy');
    }
  }

  if (t.compressAfter) {
    await assertNoRlsConflict(db, t, 'compression');
    const compressed = rowsOf<{ compression_enabled: boolean }>(await db.query(
      `SELECT compression_enabled FROM timescaledb_information.hypertables WHERE hypertable_name = $1`, [t.table],
    ))[0]?.compression_enabled === true;
    if (!compressed) {
      const seg = (t.segmentBy ?? []).map(q).join(', ');
      await db.query(`ALTER TABLE ${q(t.table)} SET (timescaledb.compress${seg ? `, timescaledb.compress_segmentby = '${seg.replace(/"/g, '')}'` : ''}, timescaledb.compress_orderby = '${t.timeColumn} DESC')`);
      actions.push('compression');
    }
    await db.query(`SELECT ${ns}.add_compression_policy($1::regclass, $2::interval, if_not_exists => true)`, [q(t.table), t.compressAfter]);
  }

  for (const agg of t.continuousAggregates ?? []) {
    const exists = rowsOf(await db.query(`SELECT 1 FROM timescaledb_information.continuous_aggregates WHERE view_name = $1`, [agg.view])).length > 0;
    if (!exists) {
      await assertNoRlsConflict(db, t, 'a continuous aggregate');
      await db.query(`CREATE MATERIALIZED VIEW ${q(agg.view)} WITH (timescaledb.continuous) AS ${agg.query} WITH NO DATA`);
      actions.push('continuous-aggregate');
    }
    await db.query(
      `SELECT ${ns}.add_continuous_aggregate_policy($1::regclass, start_offset => NULL, end_offset => $2::interval,
         schedule_interval => $3::interval, if_not_exists => true)`,
      [q(agg.view), agg.refreshLag, agg.bucket],
    );
    if (agg.retention) {
      await db.query(`SELECT ${ns}.add_retention_policy($1::regclass, $2::interval, if_not_exists => true)`, [q(agg.view), agg.retention]);
    }
  }
  return actions;
}

/**
 * Deploy phase, run AFTER `synchronize` and the SQL migrations (the table must
 * exist). Idempotent: a second run changes nothing.
 */
export async function ensureTimeSeriesTables(
  db: SqlRunner & object, tables: TimeSeriesTable[], capability?: TimescaleCapability,
): Promise<TimeSeriesReport[]> {
  const problems = validateTimeSeriesTables(tables);
  if (problems.length) throw new Error(`[time-series] invalid declaration:\n- ${problems.join('\n- ')}`);

  const cap = capability ?? await timescaleCapability(db);
  const reports: TimeSeriesReport[] = [];
  for (const t of tables) {
    if (!(await tableExists(db, t.table))) {
      Logger.warn(`[time-series] table "${t.table}" does not exist yet - skipped (is the entity registered?)`);
      reports.push({ table: t.table, mode: cap.available ? 'timescale' : 'fallback', actions: ['skipped-missing-table'] });
      continue;
    }
    // The key contract of a tenant-scoped table, enforced on the live table: refuse before changing anything.
    if (tenantColumnOf(t)) {
      const keyProblems = await liveKeyProblems(db, t);
      if (keyProblems.length) throw new Error(`[time-series] invalid key shape:\n- ${keyProblems.join('\n- ')}`);
    }
    const actions: TimeSeriesAction[] = [];
    if (cap.available) {
      actions.push(...await ensureHypertable(db, cap, t));
      if (tenantColumnOf(t)) { await ensureTenantTimeIndex(db, t); actions.push('indexes'); }
    } else {
      await ensureFallbackIndexes(db, t);
      actions.push('indexes');
    }
    if ((t.rollups?.length ?? 0) > 0) {
      await ensureRollupState(db);
      for (const r of t.rollups ?? []) {
        await ensureRollupTable(db, t, r, { grant: !cap.available });
        const asTable = rollupAsTable(t, r);
        if (cap.available) await ensureHypertable(db, cap, asTable); else await ensureFallbackIndexes(db, asTable);
        actions.push(`rollup:${r.name}`);
      }
    }
    reports.push({ table: t.table, mode: cap.available ? 'timescale' : 'fallback', actions });
  }
  return reports;
}

const DELETE_BATCH = 5_000;

async function retainOne(
  db: SqlRunner, cap: TimescaleCapability, table: string, timeColumn: string, retention: string,
): Promise<{ table: string; removed: number | 'chunks' }> {
  const isHyper = cap.available && rowsOf(await db.query(
    `SELECT 1 FROM timescaledb_information.hypertables WHERE hypertable_name = $1`, [table])).length > 0;
  if (isHyper) {
    // Tenant-scoped hypertables are owned by the owner role; the definer function lets app_admin drop chunks.
    const viaFn = rowsOf(await db.query(
      `SELECT 1 FROM pg_proc WHERE proname = '${DROP_CHUNKS_FN}'
          AND EXISTS (SELECT 1 FROM pg_class WHERE oid = to_regclass($1) AND pg_get_userbyid(relowner) = $2)
          AND NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
          AND NOT pg_has_role(current_user, $2, 'member')`, [q(table), timeSeriesOwnerRole()],
    )).length > 0;
    if (viaFn) await db.query(`SELECT ${DROP_CHUNKS_FN}($1, $2::interval)`, [table, retention]);
    else await db.query(`SELECT ${q(cap.schema ?? 'public')}.drop_chunks($1::regclass, older_than => $2::interval)`, [q(table), retention]);
    return { table, removed: 'chunks' };
  }
  let total = 0;
  for (;;) {
    const res = await db.query(
      `DELETE FROM ${q(table)} WHERE ctid IN (
         SELECT ctid FROM ${q(table)} WHERE ${q(timeColumn)} < now() - $1::interval LIMIT ${DELETE_BATCH})`,
      [retention],
    );
    // pg: { rowCount }, TypeORM: [rows, count]
    const n: number = typeof res?.rowCount === 'number' ? res.rowCount : Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
    total += n;
    if (n < DELETE_BATCH) break;
  }
  return { table, removed: total };
}

/**
 * One retention pass over one database (§5.4). Works in every mode:
 * hypertable -> `drop_chunks` (whole chunks older than the window); plain table
 * -> batched `DELETE`. On TSL the retention POLICY also runs on its own schedule;
 * this pass is the guarantee for Apache and fallback installs and is harmless
 * beside the policy. Each rollup table has its OWN retention, independent of
 * the raw table's (its rows are keyed by `bucket`).
 */
export async function runTimeSeriesRetention(
  db: SqlRunner & object, tables: TimeSeriesTable[], capability?: TimescaleCapability,
): Promise<{ table: string; removed: number | 'chunks' }[]> {
  const cap = capability ?? await timescaleCapability(db);
  const out: { table: string; removed: number | 'chunks' }[] = [];
  for (const t of tables) {
    if (t.retention && await tableExists(db, t.table)) out.push(await retainOne(db, cap, t.table, t.timeColumn, t.retention));
    for (const r of t.rollups ?? []) {
      if (r.retention && await tableExists(db, r.name)) out.push(await retainOne(db, cap, r.name, 'bucket', r.retention));
    }
  }
  return out;
}
