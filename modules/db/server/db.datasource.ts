import 'reflect-metadata';
import { DataSource, getMetadataArgsStorage } from 'typeorm';
import { env } from '@kuraykaraaslan-labs/env';
import { parseDbUrl, typeormLogging, resolveDbSslFromEnv } from './db.utils';
import { LoggerRoutedQueryLogger } from './db.query-logger';
import { registerTenantScopedTables } from './db.shadow';
import { ENTITIES } from './db.entities';
import { devSynchronize, devSyncVerified, entityMetadataDigest } from './db.dev-sync';
import { WHERE_VALUE_BEHAVIOR } from './db.where-values';

const { url: DEFAULT_DB_URL, schema: DEFAULT_SCHEMA } = parseDbUrl(env.DATABASE_URL);

// Direct (unpooled) connection for DDL: dev schema synchronize, migrations and
// heavy cross-tenant system jobs. PgBouncer / Neon *pooled* connections are
// transaction-scoped and unsuited to long DDL sessions, so prefer a dedicated
// direct URL when one is configured.
const HAS_UNPOOLED = !!env.DATABASE_URL_UNPOOLED && env.DATABASE_URL_UNPOOLED !== env.DATABASE_URL;
const { url: UNPOOLED_DB_URL, schema: UNPOOLED_SCHEMA } = parseDbUrl(env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL);

// The cross-tenant connection (docs/phases/10-db Faz 0). When an operator has created
// the `app_admin` login, this URL is how cross-tenant work identifies itself to
// Postgres — and, after the Faz 4 cutover, the only way it can: the hardened
// `app_rls_bypass()` in migration 122 asks the connection which role it is, and
// no session variable can answer that on the runtime connection's behalf.
const ADMIN_DB_URL_RAW = env.DATABASE_URL_ADMIN ?? env.DATABASE_URL_UNPOOLED ?? env.DATABASE_URL;
const HAS_ADMIN_URL = !!env.DATABASE_URL_ADMIN && env.DATABASE_URL_ADMIN !== env.DATABASE_URL;
const { url: ADMIN_DB_URL, schema: ADMIN_SCHEMA } = parseDbUrl(ADMIN_DB_URL_RAW);

export function buildDataSourceOptions(rawUrl: string, schema?: string): ConstructorParameters<typeof DataSource>[0] {
  // 38-security 7.6: TLS is required for any host that is not local or compose-internal, unless the URL / DATABASE_SSL says otherwise.
  const { url, ssl } = resolveDbSslFromEnv(rawUrl);
  return {
    type: 'postgres',
    url,
    ssl,
    schema,
    // Never TypeORM's own sync-on-initialize: in development the callers run devSynchronize() after initialize(),
    // which skips the introspect-and-diff pass when the entities have not changed and serialises concurrent DDL.
    synchronize: false,
    logging: typeormLogging(env.NODE_ENV),
    logger: new LoggerRoutedQueryLogger(env.DB_SLOW_QUERY_THRESHOLD_MS),
    entities: ENTITIES,
    // Deploy-time SQL migrations are discovered from each module's
    // server/migrations directory by db.deploy.ts.
    migrations: [],
    // A null in a where is SQL NULL, never a dropped condition (db.where-values.ts).
    invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR,
    // PgBouncer-compatible pool sizing via DB_POOL_MAX env var. keepAlive stops
    // idle pooled sockets from silently dropping (a common source of intermittent
    // ETIMEDOUT/ECONNRESET against serverless Postgres like Neon).
    extra: { max: env.DB_POOL_MAX, keepAlive: true, connectionTimeoutMillis: env.DB_POOL_ACQUIRE_TIMEOUT_MS },
  };
}

/**
 * Tell the shadow counter which tables belong to a tenant (Faz 3 §3.2).
 *
 * Derived from the entity metadata rather than a list, for the same reason the
 * RLS coverage is: a hand-kept list of 300 tables is a list that goes stale the
 * first week nobody updates it. Done once, at module load, before any query can
 * run through the logger.
 */
registerTenantScopedTables(
  (ENTITIES as Array<new (...args: never[]) => object>)
    .filter((entity) => {
      const chain: unknown[] = [];
      for (let proto: unknown = entity; proto && proto !== Function.prototype; proto = Object.getPrototypeOf(proto)) {
        chain.push(proto);
      }
      return getMetadataArgsStorage().columns.some(
        (c) => chain.includes(c.target) && (c.options?.name === 'tenantId' || c.propertyName === 'tenantId'),
      );
    })
    .map((entity) => getMetadataArgsStorage().tables.find((t) => t.target === entity)?.name)
    .filter((name): name is string => !!name),
);

// With a dedicated unpooled URL, the dev schema sync runs over it (see getDataSource);
// the pooled runtime connection then only serves queries.
const defaultDataSource = new DataSource(buildDataSourceOptions(DEFAULT_DB_URL, DEFAULT_SCHEMA));

const devSyncKey = (url: string, schema: string | undefined) => `${url}#${schema ?? ''}`;

/**
 * Development-only schema sync of an initialized DataSource (see db.dev-sync.ts): skipped when the entities are
 * unchanged since the database was last synced. Anywhere else (production, test) this does nothing.
 */
export async function devSyncIfDevelopment(ds: DataSource, url: string, schema: string | undefined, digest?: string): Promise<void> {
  if (env.NODE_ENV !== 'development') return;
  await devSynchronize(ds, { key: devSyncKey(url, schema), schema }, { force: env.NB_DEV_FORCE_SYNC === true, digest });
}

// Single-flight: initialize() (plus the dev schema sync) takes seconds, and TypeORM flips `isInitialized` right after
// connect(), before the sync. Concurrent first callers must share one run, or a second initialize()/sync races the first
// and a failure in either destroys the driver under everyone ("Driver not Connected").
let defaultInit: Promise<DataSource> | null = null;

async function initializeDefaultDataSource(): Promise<DataSource> {
  await defaultDataSource.initialize();
  if (env.NODE_ENV === 'development') {
    try {
      if (HAS_UNPOOLED) {
        // Run dev auto-sync over the direct connection rather than the pooler. The digest comes from the pooled source
        // (same entities), so a process that already verified the database does not even open the direct connection.
        const digest = entityMetadataDigest(defaultDataSource, UNPOOLED_SCHEMA);
        if (!devSyncVerified({ key: devSyncKey(UNPOOLED_DB_URL, UNPOOLED_SCHEMA), schema: UNPOOLED_SCHEMA }, digest)) {
          await synchronizeViaUnpooled(digest);
        }
      } else {
        await devSyncIfDevelopment(defaultDataSource, DEFAULT_DB_URL, DEFAULT_SCHEMA);
      }
    } catch (err) {
      // What TypeORM's own sync-on-initialize did on failure: close again, so the retry can initialize() afresh.
      await defaultDataSource.destroy().catch(() => {});
      throw err;
    }
  }
  return defaultDataSource;
}

export function getDataSource(): Promise<DataSource> {
  if (!defaultInit) {
    defaultInit = initializeDefaultDataSource().catch((err) => {
      defaultInit = null; // let the next caller retry instead of caching the failure
      throw err;
    });
  }
  return defaultInit;
}

// Apply the dev sync over a short-lived direct connection, then drop it —
// keeps DDL off the pooled connection while preserving dev auto-sync.
async function synchronizeViaUnpooled(digest: string): Promise<void> {
  const ds = new DataSource(buildDataSourceOptions(UNPOOLED_DB_URL, UNPOOLED_SCHEMA));
  await ds.initialize();
  try {
    await devSyncIfDevelopment(ds, UNPOOLED_DB_URL, UNPOOLED_SCHEMA, digest);
  } finally {
    await ds.destroy();
  }
}

// ── Read replica routing ────────────────────────────────────────────────────
// A promise slot rather than an "initialized" flag: concurrent first callers share one initialize() instead of each
// opening a pool, and a failed attempt clears the slot so the next caller retries.
let readInit: Promise<DataSource> | null = null;

export async function getReadDataSource(): Promise<DataSource> {
  if (!env.DATABASE_READ_REPLICA_URL) return getDataSource();
  if (!readInit) {
    const { url, schema } = parseDbUrl(env.DATABASE_READ_REPLICA_URL);
    readInit = initializeOnce(new DataSource({
      ...buildDataSourceOptions(url, schema),
      synchronize: false,
    }), () => { readInit = null; });
  }
  return readInit;
}

async function initializeOnce(ds: DataSource, onFailure: () => void): Promise<DataSource> {
  try {
    await ds.initialize();
    return ds;
  } catch (err) {
    onFailure();
    throw err;
  }
}

// ── System DataSource (bypasses RLS for cross-tenant cron / migrations) ─────
// Prefers DATABASE_URL_ADMIN (the `app_admin` identity) when configured, then
// the direct (unpooled) connection so heavy cross-tenant jobs don't consume
// pooled slots, and otherwise reuses the default DataSource.
// Callers still `SET LOCAL app.bypass_rls = 'on'` (see withSystemRLS) — after
// migration 122 that GUC only counts on a connection whose role is a member of
// app_admin, which is what this DataSource is for.
let systemInit: Promise<DataSource> | null = null;

export async function getSystemDataSource(): Promise<DataSource> {
  // Nothing to separate: no admin credential and no dedicated direct URL, so
  // system work shares the default connection exactly as it always has.
  if (!HAS_ADMIN_URL && !HAS_UNPOOLED) return getDataSource();
  if (!systemInit) {
    // The admin credential wins when it exists — an unpooled URL is about
    // connection SHAPE, this one is about IDENTITY, and identity is what the
    // hardened bypass check reads.
    const [url, schema] = HAS_ADMIN_URL
      ? [ADMIN_DB_URL, ADMIN_SCHEMA]
      : [UNPOOLED_DB_URL, UNPOOLED_SCHEMA];
    systemInit = initializeOnce(new DataSource({
      ...buildDataSourceOptions(url, schema),
      synchronize: false,
    }), () => { systemInit = null; });
  }
  return systemInit;
}

// ── Health check ────────────────────────────────────────────────────────────
export async function checkDataSourceHealth(): Promise<{
  default: 'ok' | 'error';
  replica: 'ok' | 'error' | 'not_configured';
  error?: string;
}> {
  let defaultStatus: 'ok' | 'error' = 'error';
  let replicaStatus: 'ok' | 'error' | 'not_configured' = 'not_configured';
  let errorMsg: string | undefined;

  try {
    const ds = await getDataSource();
    await ds.query('SELECT 1');
    defaultStatus = 'ok';
  } catch (err: unknown) {
    errorMsg = err instanceof Error ? err.message : String(err);
  }

  if (env.DATABASE_READ_REPLICA_URL) {
    try {
      const ds = await getReadDataSource();
      await ds.query('SELECT 1');
      replicaStatus = 'ok';
    } catch {
      replicaStatus = 'error';
    }
  }

  return { default: defaultStatus, replica: replicaStatus, ...(errorMsg ? { error: errorMsg } : {}) };
}
