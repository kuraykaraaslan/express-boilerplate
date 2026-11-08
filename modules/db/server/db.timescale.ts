/**
 * TimescaleDB capability probe (docs/phases/10-db phase 5 §5.1).
 *
 * Any module may declare a time-series table without knowing whether the
 * database it runs on has TimescaleDB. This file answers the question per
 * DataSource, once, and everything else (`db.time-series.ts`) branches on it.
 *
 * `edition` matters: compression, continuous aggregates and retention POLICY
 * jobs are Timescale-License (TSL) only; an Apache-only install still gets
 * hypertables and `drop_chunks`.
 */

/** Anything that can run SQL: a TypeORM DataSource/QueryRunner or a `pg` Client. */
export interface SqlRunner {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(sql: string, params?: unknown[]): Promise<any>;
}

export type TimescaleMode = 'auto' | 'off';

export interface TimescaleCapability {
  /** Extension installed in this database AND not switched off by `DB_TIMESCALE=off`. */
  available: boolean;
  edition: 'tsl' | 'apache' | null;
  version: string | null;
  /** Schema the extension lives in (function calls are qualified with it). */
  schema: string | null;
}

export const NO_TIMESCALE: TimescaleCapability = { available: false, edition: null, version: null, schema: null };

/** `DB_TIMESCALE=auto|off` (default auto). Anything unrecognised is `auto`. */
export function resolveTimescaleMode(raw: string | undefined = process.env.DB_TIMESCALE): TimescaleMode {
  return raw?.trim().toLowerCase() === 'off' ? 'off' : 'auto';
}

/** `pg` returns `{ rows }`, TypeORM returns the rows. */
export function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

const cache = new WeakMap<object, Promise<TimescaleCapability>>();

export async function probeTimescale(db: SqlRunner, mode: TimescaleMode = resolveTimescaleMode()): Promise<TimescaleCapability> {
  if (mode === 'off') return NO_TIMESCALE;
  try {
    const installed = rowsOf<{ extversion: string; schema: string }>(await db.query(
      `SELECT extversion, extnamespace::regnamespace::text AS schema FROM pg_extension WHERE extname = 'timescaledb'`,
    ))[0];
    if (!installed) return NO_TIMESCALE;
    const license = rowsOf<{ license: string | null }>(await db.query(
      `SELECT current_setting('timescaledb.license', true) AS license`,
    ))[0]?.license;
    return {
      available: true,
      edition: license === 'apache' ? 'apache' : 'tsl',
      version: installed.extversion,
      schema: installed.schema.replace(/^"|"$/g, ''),
    };
  } catch {
    // Missing catalog access or a managed provider that hides it: fall back.
    return NO_TIMESCALE;
  }
}

/** Cached per DataSource object (`DB_TIMESCALE=off` is honoured at first probe). */
export function timescaleCapability(db: SqlRunner & object): Promise<TimescaleCapability> {
  let hit = cache.get(db);
  if (!hit) { hit = probeTimescale(db); cache.set(db, hit); }
  return hit;
}

export function clearTimescaleCapabilityCache(db: object): void {
  cache.delete(db);
}

/** Whether the server could `CREATE EXTENSION timescaledb` (used by the migration's twin check). */
export async function timescaleAvailableInServer(db: SqlRunner): Promise<boolean> {
  try {
    return rowsOf(await db.query(`SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb'`)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Creates the extension only when the server offers it; otherwise a NOTICE and a clean exit so
 * vanilla / managed Postgres deployments keep deploying. Runs under the admin credential
 * (docs/phases/14-docker/03); `app_runtime` never needs extension rights. Installed into `public`
 * so the helper functions resolve from any per-module search_path (the capability probe qualifies
 * calls with the schema it reads back from pg_extension anyway).
 *
 * A server that lists the extension but cannot load it (not in shared_preload_libraries, or the
 * role lacks the right) degrades the same way: the probe then reports "unavailable" and the
 * fallback path serves.
 *
 * The preload case needs an explicit guard: timescaledb raises FATAL (not ERROR) from its _PG_init
 * when it is installed but not preloaded, which terminates the connection and no EXCEPTION block
 * can catch it (seen on a local server that had the package installed).
 *
 * This is code, not a numbered migration: `db` owns no migration files (each table's SQL lives in
 * the module that owns the table) and no module owns the extension itself.
 */
export const TIMESCALE_EXTENSION_SQL = `
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    NULL; -- already installed
  ELSIF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb')
        AND current_setting('shared_preload_libraries', true) NOT LIKE '%timescaledb%' THEN
    RAISE NOTICE 'timescaledb is installed but not in shared_preload_libraries: time-series tables fall back to plain tables';
  ELSIF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'timescaledb') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS timescaledb SCHEMA public;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'timescaledb is available but could not be created (%): time-series tables fall back to plain tables', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'timescaledb is not available on this server: time-series tables fall back to plain tables';
  END IF;
END
$$;
`;

/** Idempotent; never throws for a missing or unloadable extension (see TIMESCALE_EXTENSION_SQL). */
export async function ensureTimescaleExtension(db: SqlRunner): Promise<void> {
  await db.query(TIMESCALE_EXTENSION_SQL);
}
