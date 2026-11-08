import 'reflect-metadata';
import { createHash } from 'node:crypto';
import type { DataSource, EntityManager, EntityMetadata } from 'typeorm';
import { fieldsFromTransport, fieldsToTransport, type FieldCodec, type FieldCounts } from './db.tenant-bundle.fields';

/**
 * The lossless tenant bundle of a migration (docs/phases/02-fleet/05 section 6.3): every row of one tenant, table by table, exported on the source and
 * imported on the target with zero row or hash difference. Not `tenant_export` (that one is portability: capped, redacted, no import).
 *
 * LOSSLESS BY CONSTRUCTION. A row leaves as `to_jsonb(row)::text` and comes back through `jsonb_populate_record`: Postgres itself renders and parses
 * every type (exact numerics, timestamps with and without zone, bytea, arrays, json), so nothing passes through JavaScript numbers or dates. `jsonb`
 * also normalises the key order, so a re-export on the target yields the same bytes whatever column order its tables have, and the verification is a
 * byte comparison of per-table sha256.
 *
 * THE TARGET TRUSTS NOTHING (05 section 6.4, the guards this layer owns): before anything is written the whole bundle is checked: the manifest hashes
 * match the lines, every table is one the target knows, every line names exactly the migrated tenant, and every key is a column the target table has
 * (an unknown column aborts; `jsonb_populate_record` would silently drop it). The rows then go in, parents before children (foreign keys), inside ONE
 * transaction: a failure leaves nothing behind.
 *
 * FIELD-ENCRYPTED VALUES travel decrypted and are encrypted again under the target's own key (`db.tenant-bundle.fields.ts`): every node has its own field
 * key, so a ciphertext copied as it is would be unreadable on the target. The manifest counts them.
 *
 * NODE-OWNED ROWS (the caller's `nodeOwned`, e.g. a hard-denylisted setting) are configuration of the source node: never exported, refused on import.
 *
 * SCHEMA: the manifest names the migrations the source had applied; a target that lacks one refuses (`SCHEMA_AHEAD`), before any row is written.
 *
 * Out of scope here and named for later slices: the objects, the shadow-user subset and the user merge. The audit chain is the caller's: its `beforeRows`
 * opens the tenant's restore (audit_log `audit_chain_import_begin`), its `afterRows` records how the history was judged, and the node migration step
 * (fleet_agent) checks the proof against the source's acknowledged root and seals the stream.
 */
/**
 * 2: field-encrypted values in transport form (`fields`); a version-1 bundle carried them under the source's key and is refused.
 * 3: the source's applied migrations (`migrations`), so a target refuses a source whose schema is ahead of its own; a version-2 bundle is refused.
 */
export const BUNDLE_FORMAT_VERSION = 3;

/** At most this many migration names in a manifest, each at most `MAX_MIGRATION_NAME` characters (a node has a few hundred). */
export const MAX_MIGRATIONS = 10_000;
export const MAX_MIGRATION_NAME = 200;

/**
 * Tables that are never part of a bundle even though they carry a tenant id: facts about this node, not about the tenant (05 section 6.3 "Excluded").
 * `audit_chain_imports` is what THIS node received with a migration and how it judged it; the next node judges the history it receives itself.
 * `tenant_keys` are this node's wrapped tenant data keys: a field travels decrypted inside the sealed bundle and the target encrypts it under its own key.
 * `session_end_orders` and `session_revocation_outbox` are this node's undelivered orders to end sessions and drop caches (the session_end outbox,
 * D270): they act on `user_sessions` rows and caches that stay here, so the source delivers them and the target never replays them (02-fleet
 * decision F102).
 */
export const BUNDLE_EXCLUDED_TABLES: ReadonlySet<string> = new Set([
  'tenant_slug_tombstones', 'tenant_keys', 'user_sessions', 'session_end_orders', 'session_revocation_outbox',
  'fleet_lifecycle_outbox', 'fleet_command_receipts', 'fleet_migration_bundles', '_sql_migrations', 'audit_chain_imports',
]);
/**
 * Every `fleet_*` table is platform machinery, never a tenant's data (05 section 6.3 "Excluded": `fleet_*` node tables): the node's own records
 * (attestation leaves, receipts, outboxes, migration bundles) and the control plane's (directory, migrations, licences), whose `tenantId` names a
 * tenant without belonging to it. Excluded by prefix so a new fleet table can never ride along by having a `tenantId` column.
 */
export const BUNDLE_EXCLUDED_PREFIX = 'fleet_';

export interface BundleTable {
  /** The table name (unqualified). */
  name: string;
  /** Every column the table has, by database name. */
  columns: string[];
  /** The primary key columns: the export order inside the table. */
  primaryKey: string[];
  /** Tables this one references by foreign key (inside the set): imported first. */
  dependsOn: string[];
}

export interface BundleManifest {
  v: typeof BUNDLE_FORMAT_VERSION;
  tenantId: string;
  tables: { name: string; rows: number; sha256: string }[];
  /** Field-encrypted values carried in transport form, and the ones the source's key could not open (left as they were). */
  fields: FieldCounts;
  /**
   * The migrations the source's database had applied (`_sql_migrations` names, sorted; empty where it keeps no ledger): 05 section 6.4 "Schema". A target
   * that has not applied one of them refuses the bundle (`SCHEMA_AHEAD`): its rows may mean what only a newer schema means, even when every column fits.
   * A target that is ahead is fine: migrations are expand-only, so an older shape still imports.
   */
  migrations: string[];
}

export interface TenantBundle { manifest: BundleManifest; files: Record<string, string> }

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
/** A quoted SQL identifier. */
export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/**
 * The tenant-scoped tables of a DataSource in import order: every entity with a `tenantId` column, minus the excluded ones, sorted so that a table comes
 * after the tables it references. A foreign-key cycle inside the set is refused: it would need deferred constraints, which TypeORM does not create.
 */
export function bundleTablesFrom(metadatas: readonly EntityMetadata[], exclude: ReadonlySet<string> = BUNDLE_EXCLUDED_TABLES): BundleTable[] {
  const scoped = metadatas.filter((m) => m.tableType === 'regular' && !exclude.has(m.tableName) && !m.tableName.startsWith(BUNDLE_EXCLUDED_PREFIX) && m.columns.some((c) => c.databaseName === 'tenantId'));
  const names = new Set(scoped.map((m) => m.tableName));
  const tables = new Map<string, BundleTable>(scoped.map((m) => [m.tableName, {
    name: m.tableName,
    columns: m.columns.map((c) => c.databaseName),
    primaryKey: m.primaryColumns.map((c) => c.databaseName),
    dependsOn: [...new Set(m.foreignKeys.map((fk) => fk.referencedTablePath.split('.').pop()!).filter((t) => t !== m.tableName && names.has(t)))],
  }]));
  const ordered: BundleTable[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (name: string, path: string[]) => {
    if (state.get(name) === 'done') return;
    if (state.get(name) === 'visiting') throw new Error(`tenant bundle: foreign-key cycle ${[...path, name].join(' -> ')}`);
    state.set(name, 'visiting');
    for (const dep of tables.get(name)!.dependsOn) visit(dep, [...path, name]);
    state.set(name, 'done');
    ordered.push(tables.get(name)!);
  };
  for (const name of [...names].sort()) visit(name, []);
  return ordered;
}

/** The query that renders a tenant's rows of one table, one canonical jsonb text per row, in primary-key order. */
export function exportSql(schema: string, t: BundleTable): string {
  const order = (t.primaryKey.length ? t.primaryKey : t.columns).map((c) => `t.${ident(c)}`).join(', ');
  return `SELECT to_jsonb(t)::text AS line FROM ${ident(schema)}.${ident(t.name)} t WHERE t."tenantId" = $1 ORDER BY ${order}`;
}

/** A node without a field key opens no envelope (each is counted unreadable and kept) and cannot encrypt one. */
export const NO_FIELD_KEY: FieldCodec = { decrypt: () => null, encrypt: () => { throw new Error('no field key'); } };

/** The migrations a schema's database has applied (its `_sql_migrations` ledger), sorted; empty when it keeps no ledger. */
export async function appliedMigrations(q: { query(sql: string, params?: unknown[]): Promise<unknown> }, schema: string): Promise<string[]> {
  const ledger = `${ident(schema)}._sql_migrations`;
  const has = ((await q.query('SELECT to_regclass($1) IS NOT NULL AS ok', [ledger])) as { ok: boolean }[])[0]?.ok === true;
  if (!has) return [];
  return ((await q.query(`SELECT name FROM ${ledger} ORDER BY name`)) as { name: string }[]).map((r) => r.name);
}

/**
 * Calls `onLine` with every row of `tenantId` in table `t` (canonical jsonb text, primary-key order) through a server-side cursor, `batch` rows per FETCH:
 * the table is never held in memory. Runs inside the caller's transaction (a cursor lives only there), so a repeatable-read caller sees one snapshot.
 */
export async function forEachTenantRow(m: EntityManager, schema: string, t: BundleTable, tenantId: string, onLine: (line: string) => void | Promise<void>, batch = 500): Promise<void> {
  await m.query(`DECLARE fleet_bundle_rows NO SCROLL CURSOR FOR ${exportSql(schema, t)}`, [tenantId]);
  try {
    for (;;) {
      const rows = (await m.query(`FETCH ${Math.max(1, Math.floor(batch))} FROM fleet_bundle_rows`)) as { line: string }[];
      for (const r of rows) await onLine(r.line);
      if (rows.length < batch) break;
    }
  } finally {
    await m.query('CLOSE fleet_bundle_rows');
  }
}

async function exportWith(m: EntityManager, schema: string, tenantId: string, tables: readonly BundleTable[], codec: FieldCodec = NO_FIELD_KEY, nodeOwned?: BundleDbOptions['nodeOwned']): Promise<TenantBundle> {
  const files: Record<string, string> = {};
  const manifest: BundleManifest = { v: BUNDLE_FORMAT_VERSION, tenantId, tables: [], fields: { reencrypted: 0, unreadable: 0 }, migrations: await appliedMigrations(m, schema) };
  for (const t of tables) {
    const parts: string[] = [];
    await forEachTenantRow(m, schema, t, tenantId, (line) => { if (!nodeOwned?.(t.name, line)) parts.push(`${fieldsToTransport(line, codec, manifest.fields)}\n`); });
    const ndjson = parts.join('');
    files[t.name] = ndjson;
    manifest.tables.push({ name: t.name, rows: parts.length, sha256: sha256(ndjson) });
  }
  return { manifest, files };
}

/** The per-table row counts and sha256 of a tenant's rows as an export would render them, without keeping a line: what verification compares. */
export async function hashTenantRows(m: EntityManager, schema: string, tenantId: string, tables: readonly BundleTable[], codec: FieldCodec = NO_FIELD_KEY, nodeOwned?: BundleDbOptions['nodeOwned']): Promise<{ name: string; rows: number; sha256: string }[]> {
  const out: { name: string; rows: number; sha256: string }[] = [];
  const counts: FieldCounts = { reencrypted: 0, unreadable: 0 };
  for (const t of tables) {
    const h = createHash('sha256'); let rows = 0;
    await forEachTenantRow(m, schema, t, tenantId, (line) => { if (!nodeOwned?.(t.name, line)) { h.update(`${fieldsToTransport(line, codec, counts)}\n`, 'utf8'); rows++; } });
    out.push({ name: t.name, rows, sha256: h.digest('hex') });
  }
  return out;
}

/**
 * Exports every row of `tenantId` from `tables` (in their order), in ONE repeatable-read transaction so the bundle is a consistent snapshot even while
 * reads go on (the source is frozen READ_ONLY during a migration export, 05 section 6.2).
 */
export async function exportTenantBundle(ds: DataSource, schema: string, tenantId: string, tables: readonly BundleTable[], opts: BundleDbOptions = {}): Promise<TenantBundle> {
  return ds.transaction('REPEATABLE READ', async (m) => {
    if (opts.bypassRls) await m.query("SET LOCAL app.bypass_rls = 'on'");
    return exportWith(m, schema, tenantId, tables, opts.fields, opts.nodeOwned);
  });
}

/**
 * `bypassRls`: the transaction sets the system bypass (`app.bypass_rls`, the GUC `withSystemRLS` sets). A node's migration step passes it with the SYSTEM
 * DataSource: with RLS forced, a plain transaction would see no tenant rows at all (05 section 6.3 reads every row of one tenant, on purpose).
 */
export interface BundleDbOptions {
  bypassRls?: boolean;
  /** This node's field key (export and verify open envelopes with it, import encrypts with it). Without it no envelope is opened and an import that carries a field is refused. */
  fields?: FieldCodec;
  /**
   * A row that is the node's own configuration, not the tenant's (the caller decides, e.g. a hard-denylisted setting): export and verify leave it out,
   * import refuses a bundle that has one (05 section 6.4: the target trusts nothing). The tenant then takes the target's value.
   */
  nodeOwned?: (table: string, line: string) => boolean;
  /** Import only: runs inside the import transaction before the first row (e.g. the audit chain's import marker, `app.audit_import`). */
  beforeRows?: (m: EntityManager) => Promise<void>;
  /** Import only: runs inside the import transaction after the last row (e.g. the record of how the imported audit history was judged). */
  afterRows?: (m: EntityManager) => Promise<void>;
  /**
   * Import only: the target's own judgement of one row as it will be written (field transport already decoded and encrypted under this node's key): null
   * admits it, a reason code refuses the whole bundle before anything is written (05 section 6.4: e.g. settings re-validated against the target's rules).
   */
  admitRow?: (table: string, line: string) => string | null;
}

export type BundleRefusal =
  | { code: 'BAD_MANIFEST' } | { code: 'TENANT_MISMATCH'; table: string } | { code: 'UNKNOWN_TABLE'; table: string } | { code: 'MISSING_TABLE'; table: string }
  | { code: 'HASH_MISMATCH'; table: string } | { code: 'ROW_COUNT_MISMATCH'; table: string } | { code: 'FOREIGN_TENANT'; table: string; line: number }
  | { code: 'UNKNOWN_COLUMN'; table: string; column: string } | { code: 'BAD_LINE'; table: string; line: number }
  | { code: 'FIELD_KEY_MISSING'; table: string } | { code: 'NODE_OWNED_ROW'; table: string; line: number }
  | { code: 'UNIQUE_CONFLICT'; table: string; constraint: string } | { code: 'ROW_REFUSED'; table: string; line: number; reason: string }
  | { code: 'SCHEMA_AHEAD'; missing: number; first: string }
  /** A storage object of a streamed bundle (format 4) refused: `reason` is KEY, ORDER, TOO_LARGE, BAD_DATA, HASH or the caller's `admitObject` verdict; `index` counts from 1. */
  | { code: 'OBJECT_REFUSED'; reason: string; index: number }
  /** The members section of a streamed bundle refused (`db.tenant-bundle.members.ts`): `reason` is a shape code, ORDER, NOT_A_MEMBER, TOO_MANY, UNSUPPORTED or the importer's own (`MemberRefused`); `index` counts from 1 (0 when not one member's). */
  | { code: 'MEMBER_REFUSED'; reason: string; index: number };

/** Every check that needs no database: run on the whole bundle before the first row is written. Null when the bundle may be imported. */
export function checkTenantBundle(bundle: TenantBundle, tenantId: string, tables: readonly BundleTable[]): BundleRefusal | null {
  const { manifest, files } = bundle;
  if (!manifest || manifest.v !== BUNDLE_FORMAT_VERSION || !Array.isArray(manifest.tables)) return { code: 'BAD_MANIFEST' };
  const counted = (n: unknown) => Number.isInteger(n) && (n as number) >= 0;
  if (!manifest.fields || !counted(manifest.fields.reencrypted) || !counted(manifest.fields.unreadable)) return { code: 'BAD_MANIFEST' };
  if (!Array.isArray(manifest.migrations) || manifest.migrations.length > MAX_MIGRATIONS
    || !manifest.migrations.every((n) => typeof n === 'string' && n.length > 0 && n.length <= MAX_MIGRATION_NAME)) return { code: 'BAD_MANIFEST' };
  if (manifest.tenantId !== tenantId) return { code: 'TENANT_MISMATCH', table: '' };
  const known = new Map(tables.map((t) => [t.name, t]));
  const listed = new Set<string>();
  for (const entry of manifest.tables) {
    const t = known.get(entry.name);
    if (!t) return { code: 'UNKNOWN_TABLE', table: entry.name };
    listed.add(entry.name);
    const ndjson = files[entry.name] ?? '';
    if (sha256(ndjson) !== entry.sha256) return { code: 'HASH_MISMATCH', table: entry.name };
    const lines = ndjson === '' ? [] : ndjson.slice(0, -1).split('\n');
    if (lines.length !== entry.rows) return { code: 'ROW_COUNT_MISMATCH', table: entry.name };
    const columns = new Set(t.columns);
    for (let i = 0; i < lines.length; i++) {
      let row: unknown;
      try { row = JSON.parse(lines[i]!); } catch { return { code: 'BAD_LINE', table: entry.name, line: i + 1 }; }
      if (!row || typeof row !== 'object' || Array.isArray(row)) return { code: 'BAD_LINE', table: entry.name, line: i + 1 };
      if ((row as { tenantId?: unknown }).tenantId !== tenantId) return { code: 'FOREIGN_TENANT', table: entry.name, line: i + 1 };
      for (const k of Object.keys(row)) if (!columns.has(k)) return { code: 'UNKNOWN_COLUMN', table: entry.name, column: k };
    }
  }
  for (const f of Object.keys(files)) if (!listed.has(f)) return { code: 'UNKNOWN_TABLE', table: f };
  for (const t of tables) if (!listed.has(t.name)) return { code: 'MISSING_TABLE', table: t.name };
  return null;
}

/**
 * Imports a checked bundle into `schema`, parents before children, in ONE transaction: every row or none. Refuses (writing nothing) whatever
 * `checkTenantBundle` refuses. Returns the rows written per table.
 */
export async function importTenantBundle(ds: DataSource, schema: string, tenantId: string, bundle: TenantBundle, tables: readonly BundleTable[], opts: BundleDbOptions = {}): Promise<{ ok: true; rows: Record<string, number> } | { ok: false; refusal: BundleRefusal }> {
  const refusal = checkTenantBundle(bundle, tenantId, tables);
  if (refusal) return { ok: false, refusal };
  // a source that applied a migration this node has not is ahead of it (05 section 6.4 "Schema"): nothing is written
  const mine = new Set(await appliedMigrations(ds, schema));
  const ahead = bundle.manifest.migrations.filter((n) => !mine.has(n));
  if (ahead.length) return { ok: false, refusal: { code: 'SCHEMA_AHEAD', missing: ahead.length, first: ahead[0]! } };
  // Every transported field is encrypted under this node's key before the first row is written: a node that cannot do so writes nothing.
  const local = new Map<string, string[]>();
  for (const t of tables) {
    const ndjson = bundle.files[t.name] ?? '';
    const lines = ndjson === '' ? [] : ndjson.slice(0, -1).split('\n');
    const owned = opts.nodeOwned ? lines.findIndex((line) => opts.nodeOwned!(t.name, line)) : -1;
    if (owned >= 0) return { ok: false, refusal: { code: 'NODE_OWNED_ROW', table: t.name, line: owned + 1 } };
    let decoded: string[];
    try {
      decoded = lines.map((line) => fieldsFromTransport(line, opts.fields ?? NO_FIELD_KEY));
    } catch {
      return { ok: false, refusal: { code: 'FIELD_KEY_MISSING', table: t.name } };
    }
    if (opts.admitRow) {
      for (const [i, line] of decoded.entries()) {
        const reason = opts.admitRow(t.name, line);
        if (reason) return { ok: false, refusal: { code: 'ROW_REFUSED', table: t.name, line: i + 1, reason } };
      }
    }
    local.set(t.name, decoded);
  }
  const rows: Record<string, number> = {};
  try {
    await ds.transaction(async (m) => {
      if (opts.bypassRls) await m.query("SET LOCAL app.bypass_rls = 'on'");
      if (opts.beforeRows) await opts.beforeRows(m);
      for (const t of tables) {
        const lines = local.get(t.name)!;
        const target = `${ident(schema)}.${ident(t.name)}`;
        for (const line of lines) await m.query(`INSERT INTO ${target} SELECT * FROM jsonb_populate_record(NULL::${target}, $1::jsonb)`, [line]);
        rows[t.name] = lines.length;
      }
      if (opts.afterRows) await opts.afterRows(m);
    });
  } catch (e) {
    // A value unique on this node is already taken here (a slug, a custom domain, ...): the transaction wrote nothing, and the caller learns which.
    const pg = (e as { driverError?: { code?: string; table?: string; constraint?: string } }).driverError;
    if (pg?.code === '23505') return { ok: false, refusal: { code: 'UNIQUE_CONFLICT', table: pg.table ?? '', constraint: pg.constraint ?? '' } };
    throw e;
  }
  return { ok: true, rows };
}

/**
 * Re-exports the imported tenant from `schema` and compares it with the manifest, table by table (the VERIFYING step's row and hash comparison).
 * Returns the tables that differ; empty means a lossless copy.
 */
export async function verifyTenantBundle(ds: DataSource, schema: string, manifest: Pick<BundleManifest, 'tenantId' | 'tables'>, tables: readonly BundleTable[], opts: BundleDbOptions = {}): Promise<string[]> {
  const again = await ds.transaction('REPEATABLE READ', async (m) => {
    if (opts.bypassRls) await m.query("SET LOCAL app.bypass_rls = 'on'");
    return hashTenantRows(m, schema, manifest.tenantId, tables, opts.fields, opts.nodeOwned);
  });
  const want = new Map(manifest.tables.map((t) => [t.name, t]));
  return again.filter((t) => want.get(t.name)?.sha256 !== t.sha256 || want.get(t.name)?.rows !== t.rows).map((t) => t.name);
}

/**
 * Removes every row of `tenantId` from `tables`, children before parents, in ONE transaction: a failed or aborted import on the TARGET (05 section 6.2
 * ABORTED: "target: drop imported rows"; 6.4: "failure = cascade delete of everything written"). Only the bundle's own table set is touched. Returns the
 * rows removed per table.
 */
export async function discardTenantRows(ds: DataSource, schema: string, tenantId: string, tables: readonly BundleTable[], opts: BundleDbOptions = {}): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
  await ds.transaction(async (m) => {
    if (opts.bypassRls) await m.query("SET LOCAL app.bypass_rls = 'on'");
    for (const t of [...tables].reverse()) {
      const r: unknown = await m.query(`DELETE FROM ${ident(schema)}.${ident(t.name)} WHERE "tenantId" = $1`, [tenantId]);
      removed[t.name] = Array.isArray(r) && typeof r[1] === 'number' ? r[1] : 0;
    }
  });
  return removed;
}
