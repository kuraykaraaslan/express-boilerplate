import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DataSource } from 'typeorm';
import Logger from '@kuraykaraaslan-labs/logger';

/**
 * Development schema sync with a change check (development only; production never calls this).
 *
 * `next dev` builds the db module once per bundle layer (app-route, app-rsc, middleware, sometimes instrumentation),
 * and each sidecar builds it again on every `tsx watch` restart. With TypeORM's `synchronize: true` every one of them
 * introspected and diffed ~400 entities on start, and nothing stopped two of them from running DDL at the same time
 * right after an entity change. Instead, the DataSources are built with `synchronize: false` and this runs the sync only
 * when a digest of the entity metadata (plus the TypeORM version and the target schema) differs from the one recorded
 * in the one-row `_dev_sync_state` table, under an advisory lock so one process syncs while the others wait and then
 * see the new digest.
 *
 * Trade-off: drift made by hand (a column dropped in psql) is not repaired until an entity changes. Set
 * NB_DEV_FORCE_SYNC=true to sync regardless (once per process and database).
 */

const STATE_TABLE = '_dev_sync_state';
const LOCK_PREFIX = 'next-boilerplate:dev-sync:';

// Process-wide, so the bundle layers of one `next dev` process share it. Only strings are kept here: a DataSource
// must never cross bundle graphs (entity class identity differs per bundle), but "this database already matches
// digest X" holds for every layer.
const MEMO = Symbol.for('next-boilerplate.db.devSyncVerified');
function memo(): Map<string, string> {
  const g = globalThis as unknown as Record<symbol, Map<string, string> | undefined>;
  return (g[MEMO] ??= new Map());
}

function typeormVersion(): string {
  // typeorm does not export its package.json; dev runs from the project root (next dev and the dev.mjs sidecars).
  try {
    const pkg = JSON.parse(readFileSync(path.join(process.cwd(), 'node_modules', 'typeorm', 'package.json'), 'utf8')) as { version?: string };
    return pkg.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

/**
 * Reduce a metadata object to what can shape DDL, generically: primitives, arrays and plain objects are kept, other
 * class instances (back-references to entity, relation and column metadata) are dropped, a constructor becomes its
 * name and an arrow function (a column default such as `() => 'now()'`) becomes what it returns. Taking every such
 * property rather than a hand-picked list means a TypeORM option nobody thought of still changes the digest.
 */
function plain(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === 'function') {
    if (value.prototype) return `fn:${value.name}`;
    try {
      return `fn=>${String((value as () => unknown)())}`;
    } catch {
      return `fn:${value.toString()}`;
    }
  }
  if (typeof value !== 'object') return value;
  if (depth > 3) return null;
  if (Array.isArray(value)) return value.map((v) => plain(v, depth + 1));
  if (value instanceof Date || value instanceof RegExp) return String(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null && depth > 0) return null;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) {
    const v = plain((value as Record<string, unknown>)[key], depth + 1);
    if (v !== null) out[key] = v;
  }
  return out;
}

const byName = (a: { k: string }, b: { k: string }) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0);
function sortedPlain<T>(items: readonly T[], key: (t: T) => string): unknown[] {
  return items.map((t) => ({ k: key(t), v: plain(t) })).sort(byName).map((x) => x.v);
}

/** Digest of everything `synchronize` would build for this DataSource (call after initialize()). */
export function entityMetadataDigest(ds: DataSource, schema: string | undefined): string {
  const entities = ds.entityMetadatas
    .map((m) => ({
      k: m.tablePath,
      v: {
        table: m.tablePath,
        tableType: m.tableType,
        expression: typeof m.expression === 'string' ? m.expression : m.expression ? 'fn' : null,
        synchronize: m.synchronize,
        columns: sortedPlain(m.columns, (c) => c.databaseName),
        indices: sortedPlain(m.indices, (i) => i.name),
        uniques: sortedPlain(m.uniques, (u) => u.name),
        checks: sortedPlain(m.checks, (c) => c.name),
        exclusions: sortedPlain(m.exclusions, (e) => e.name),
        foreignKeys: sortedPlain(m.foreignKeys, (f) => f.name),
      },
    }))
    .sort(byName)
    .map((x) => x.v);
  return createHash('sha256')
    .update(JSON.stringify({ format: 1, typeorm: typeormVersion(), schema: schema ?? null, entities }))
    .digest('hex');
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function stateTable(schema: string | undefined): string {
  return schema ? `${quoteIdent(schema)}.${quoteIdent(STATE_TABLE)}` : quoteIdent(STATE_TABLE);
}

interface Queryable { query(sql: string, params?: unknown[]): Promise<unknown> }

async function readRecordedDigest(q: Queryable, schema: string | undefined): Promise<string | null> {
  try {
    const rows = (await q.query(`SELECT digest FROM ${stateTable(schema)} WHERE id`)) as Array<{ digest: string }>;
    return rows[0]?.digest ?? null;
  } catch {
    return null; // no table yet (fresh database): treat as never synced
  }
}

export interface DevSyncTarget {
  /** Identifies the database for the process-wide memo (url plus schema). */
  key: string;
  schema: string | undefined;
}

/** True when this process already verified `target` against `digest`, so nothing needs to touch the database. */
export function devSyncVerified(target: DevSyncTarget, digest: string): boolean {
  return memo().get(target.key) === digest;
}

/**
 * Bring `ds`'s database to its entity schema if the recorded digest differs (or NB_DEV_FORCE_SYNC is set).
 * `digest` may be passed when it was already computed from an identical entity set.
 */
export async function devSynchronize(
  ds: DataSource,
  target: DevSyncTarget,
  opts: { force?: boolean; digest?: string } = {},
): Promise<'skipped' | 'synced'> {
  const digest = opts.digest ?? entityMetadataDigest(ds, target.schema);
  if (devSyncVerified(target, digest)) return 'skipped';

  if (!opts.force && (await readRecordedDigest(ds, target.schema)) === digest) {
    memo().set(target.key, digest);
    return 'skipped';
  }

  // A session-level lock on one held connection (the sync itself runs on others from the pool). The DDL paths use the
  // direct connection when one is configured, where session locks are reliable.
  const qr = ds.createQueryRunner();
  await qr.connect();
  const lockKey = `${LOCK_PREFIX}${target.schema ?? ''}`;
  try {
    await qr.query('SELECT pg_advisory_lock(hashtext($1)::bigint)', [lockKey]);
    try {
      // Another process may have synced while this one waited for the lock.
      if (!opts.force && (await readRecordedDigest(qr, target.schema)) === digest) {
        memo().set(target.key, digest);
        return 'skipped';
      }
      const started = Date.now();
      await ds.synchronize();
      if (target.schema) await qr.query(`CREATE SCHEMA IF NOT EXISTS ${quoteIdent(target.schema)}`);
      await qr.query(
        `CREATE TABLE IF NOT EXISTS ${stateTable(target.schema)} (
          id boolean PRIMARY KEY DEFAULT true CHECK (id),
          digest text NOT NULL,
          synced_at timestamptz NOT NULL DEFAULT now()
        )`,
      );
      await qr.query(
        `INSERT INTO ${stateTable(target.schema)} (id, digest, synced_at) VALUES (true, $1, now())
         ON CONFLICT (id) DO UPDATE SET digest = EXCLUDED.digest, synced_at = EXCLUDED.synced_at`,
        [digest],
      );
      memo().set(target.key, digest);
      Logger.info(`[db] dev schema synchronized (${Date.now() - started} ms)${opts.force ? ' (NB_DEV_FORCE_SYNC)' : ''}`);
      return 'synced';
    } finally {
      await qr.query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [lockKey]).catch(() => {});
    }
  } finally {
    await qr.release();
  }
}
