import { createHash } from 'node:crypto';
import { loadModuleMigrations } from './db.migration-files';
import { migrationChecksum } from './db.migration-plan';

/**
 * The schema version of THIS code: what a build expects the database to look
 * like. Pure and database-free, so it is stable across builds, unit-testable and
 * usable in CI (`modules/db/scripts/db-schema-version.ts`) and by the release pipeline.
 *
 *   <highest migration number>.<16 hex chars>      e.g. `127.3fa9c01be2d47a16`
 *
 * The hex part is a sha256 over (a) every migration `<module>:<file>` with its
 * checksum and (b) a canonical dump of the TypeORM entity metadata (tables,
 * columns, indexes, uniques, checks, exclusions, foreign keys, relations), so it
 * changes when a migration is added or edited and when an entity changes the
 * schema `synchronize` would build. It is an IDENTITY, not an ordering key:
 * migrations are numbered per module, so "highest" is only the largest number any
 * module has reached. At most 20 characters, which fits `tenant_databases.schemaVersion`
 * (varchar 32) and the release manifest's `schemaVersion`.
 */

export interface SchemaVersion {
  /** `<highestMigration>.<16 hex>`. */
  schemaVersion: string;
  /** Largest numeric file prefix over all modules (0 when no file is numbered). */
  highestMigration: number;
  migrationCount: number;
  /** sha256 hex over the sorted `name:checksum` list. */
  migrationsDigest: string;
  /** sha256 hex over the canonical entity metadata. */
  entitiesDigest: string;
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Numeric prefix of `<module>:<NNN_name>.sql`, or 0 when the file name does not start with digits. */
export function migrationNumber(name: string): number {
  const match = /^[^:]*:(\d+)/.exec(name);
  return match ? Number(match[1]) : 0;
}

export function computeSchemaVersion(input: {
  migrations: ReadonlyArray<{ name: string; checksum: string }>;
  entitiesDigest: string;
}): SchemaVersion {
  const sorted = [...input.migrations].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  const migrationsDigest = sha256Hex(sorted.map((m) => `${m.name}:${m.checksum}`).join('\n'));
  const highestMigration = sorted.reduce((max, m) => Math.max(max, migrationNumber(m.name)), 0);
  const hash = sha256Hex(`${migrationsDigest}\n${input.entitiesDigest}`).slice(0, 16);
  return {
    schemaVersion: `${highestMigration}.${hash}`,
    highestMigration,
    migrationCount: sorted.length,
    migrationsDigest,
    entitiesDigest: input.entitiesDigest,
  };
}

// ── Entity metadata digest ───────────────────────────────────────────────────

type Target = Function | string;

/** The part of TypeORM's `MetadataArgsStorage` the digest reads (so tests can pass a plain fake). */
export interface MetadataStorageLike {
  readonly tables: ReadonlyArray<{ target: Target } & Record<string, unknown>>;
  readonly generations: ReadonlyArray<{ target: Target; propertyName: string; strategy: string }>;
  filterColumns(target: Target[]): ReadonlyArray<{ propertyName: string; mode?: string; options?: Record<string, unknown> }>;
  filterIndices(target: Target[]): ReadonlyArray<Record<string, unknown>>;
  filterUniques(target: Target[]): ReadonlyArray<Record<string, unknown>>;
  filterChecks(target: Target[]): ReadonlyArray<Record<string, unknown>>;
  filterExclusions(target: Target[]): ReadonlyArray<Record<string, unknown>>;
  filterForeignKeys(target: Target[]): ReadonlyArray<Record<string, unknown>>;
  filterRelations(target: Target[]): ReadonlyArray<{ propertyName: string; relationType: string; type?: unknown; options?: Record<string, unknown> }>;
  filterEmbeddeds(target: Target[]): ReadonlyArray<{ propertyName: string; prefix?: unknown; array?: boolean; type?: unknown }>;
  filterJoinColumns(target: Target, propertyName: string): ReadonlyArray<Record<string, unknown>>;
  findJoinTable(target: Target, propertyName: string): Record<string, unknown> | undefined;
}

/** A column-list option (`columns`) may be a function of a property proxy: resolve it to property names. */
function resolveColumnsOption(columns: unknown): unknown {
  if (typeof columns !== 'function') return columns;
  try {
    const proxy = new Proxy({}, { get: (_t, key) => String(key) });
    const result = (columns as (o: unknown) => unknown)(proxy);
    return Array.isArray(result) ? result : result && typeof result === 'object' ? Object.keys(result) : '[fn]';
  } catch {
    return '[fn]';
  }
}

function typeLabel(type: unknown): unknown {
  if (typeof type === 'function') {
    try {
      const resolved = (type as () => unknown)();
      if (typeof resolved === 'function') return resolved.name;
      if (typeof resolved === 'string') return resolved;
    } catch {
      // A class used as a type (not a thunk) throws when called without `new`: its name is the label.
    }
    return (type as { name?: string }).name || '[fn]';
  }
  return type;
}

/**
 * JSON-able, key-order independent form of a metadata value. Functions carry no
 * schema information (transformers, factories) and become a marker, except
 * a `default` factory, which is called because `() => 'now()'` IS schema.
 */
function canon(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[deep]';
  if (value === null) return null;
  switch (typeof value) {
    case 'undefined': return undefined;
    case 'function': return '[fn]';
    case 'bigint': return value.toString();
    case 'symbol': return value.toString();
    case 'object': break;
    default: return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => canon(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object).sort()) {
    const entry = (value as Record<string, unknown>)[key];
    const resolved = key === 'default' && typeof entry === 'function' ? callDefault(entry) : canon(entry, depth + 1);
    if (resolved !== undefined) out[key] = resolved;
  }
  return out;
}

function callDefault(factory: unknown): unknown {
  try {
    return canon((factory as () => unknown)());
  } catch {
    return '[fn]';
  }
}

function inheritanceTree(target: Function): Function[] {
  const tree: Function[] = [];
  for (let t: unknown = target; typeof t === 'function' && t !== Function.prototype; t = Object.getPrototypeOf(t)) {
    tree.push(t as Function);
  }
  return tree;
}

const DDL_RELATION_OPTIONS = ['onDelete', 'onUpdate', 'nullable', 'primary', 'deferrable', 'createForeignKeyConstraints'];

function pick(source: Record<string, unknown> | undefined, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (source && source[key] !== undefined) out[key] = source[key];
  return out;
}

function describeColumns(storage: MetadataStorageLike, tree: Target[], depth: number): unknown[] {
  const generated = new Map(
    storage.generations
      .filter((g) => tree.includes(g.target))
      .map((g) => [g.propertyName, g.strategy] as const),
  );
  const columns = storage.filterColumns(tree)
    .map((c) => ({ property: c.propertyName, mode: c.mode, generation: generated.get(c.propertyName), options: c.options ?? {} }))
    .sort((a, b) => (a.property < b.property ? -1 : 1));
  const embeddeds = storage.filterEmbeddeds(tree)
    .map((e) => {
      const type = typeof e.type === 'function' ? (e.type as () => unknown)() : e.type;
      const embeddedTree = typeof type === 'function' && depth < 4 ? inheritanceTree(type as Function) : [];
      return {
        embedded: e.propertyName,
        prefix: typeof e.prefix === 'function' ? '[fn]' : e.prefix,
        array: e.array === true,
        columns: embeddedTree.length > 0 ? describeColumns(storage, embeddedTree, depth + 1) : [],
      };
    })
    .sort((a, b) => (a.embedded < b.embedded ? -1 : 1));
  return [...columns, ...embeddeds].map((c) => canon(c) as unknown);
}

/** Canonical dump of the schema-relevant TypeORM metadata of `entities`, hashed. Independent of any database. */
export function entityMetadataDigest(storage: MetadataStorageLike, entities: ReadonlyArray<Function>): string {
  const tables = entities.map((entity) => {
    const tree = inheritanceTree(entity);
    const table = storage.tables.find((t) => t.target === entity);
    const name = typeof table?.name === 'string' ? table.name : entity.name;
    const relations = storage.filterRelations(tree)
      .map((r) => ({
        property: r.propertyName,
        kind: r.relationType,
        type: typeLabel(r.type),
        options: pick(r.options, DDL_RELATION_OPTIONS),
        joinColumns: storage.filterJoinColumns(entity, r.propertyName).map((j) => canon(j)),
        joinTable: canon(storage.findJoinTable(entity, r.propertyName) ?? null),
      }))
      .sort((a, b) => (a.property < b.property ? -1 : 1));
    const constraint = (list: ReadonlyArray<Record<string, unknown>>) =>
      list
        .map((c) => canon({ ...c, target: undefined, columns: resolveColumnsOption(c.columns), type: typeLabel(c.type), inverseSide: undefined }))
        .map((c) => JSON.stringify(c))
        .sort();
    return {
      table: canon(pick(table, ['name', 'type', 'schema', 'database', 'synchronize', 'expression'])),
      resolvedName: name,
      columns: describeColumns(storage, tree, 0),
      indices: constraint(storage.filterIndices(tree)),
      uniques: constraint(storage.filterUniques(tree)),
      checks: constraint(storage.filterChecks(tree)),
      exclusions: constraint(storage.filterExclusions(tree)),
      foreignKeys: constraint(storage.filterForeignKeys(tree)),
      relations: canon(relations),
    };
  });
  return sha256Hex(tables.map((t) => JSON.stringify(t)).sort().join('\n'));
}

/** The schema version of the code in this checkout: real migration files and the registered entities. */
export async function currentSchemaVersion(): Promise<SchemaVersion> {
  const [{ getMetadataArgsStorage }, { ENTITIES }] = await Promise.all([import('typeorm'), import('./db.entities')]);
  const entitiesDigest = entityMetadataDigest(
    getMetadataArgsStorage() as unknown as MetadataStorageLike,
    ENTITIES as unknown as Function[],
  );
  const migrations = loadModuleMigrations().map((f) => ({ name: f.name, checksum: migrationChecksum(f.sql) }));
  return computeSchemaVersion({ migrations, entitiesDigest });
}

// ── Cached form for the health routes ────────────────────────────────────────

let cachedCodeVersion: Promise<SchemaVersion | null> | null = null;
let resolvedCodeVersion: SchemaVersion | null = null;

/**
 * `currentSchemaVersion()` for a running process: computed once, never throws, and null when it cannot be known
 * (a runtime image without the `modules/<id>/server/migrations` files, which would otherwise hash as "no migrations at all" and
 * report a confident, wrong identity). The hash needs no database. A failure is not cached, so the next probe retries.
 */
export function codeSchemaVersion(): Promise<SchemaVersion | null> {
  cachedCodeVersion ??= currentSchemaVersion()
    .then((version) => {
      resolvedCodeVersion = version.migrationCount === 0 ? null : version;
      return resolvedCodeVersion;
    })
    .catch(() => {
      cachedCodeVersion = null;
      return null;
    });
  return cachedCodeVersion;
}

/**
 * Non-blocking form for a liveness probe, which must answer immediately: the version if it has been computed,
 * otherwise null while the computation is started in the background (the next probe sees it).
 */
export function peekCodeSchemaVersion(): SchemaVersion | null {
  void codeSchemaVersion();
  return resolvedCodeVersion;
}

/** Test seam: forget the cached code version. */
export function resetCodeSchemaVersionCache(): void {
  cachedCodeVersion = null;
  resolvedCodeVersion = null;
}

/**
 * The only part of a schema version the unauthenticated probes expose: the 16 hex characters. The migration number in
 * front of it says how many steps the schema has taken, which an anonymous caller has no use for.
 */
export function shortSchemaHash(schemaVersion: string | null | undefined): string | null {
  const match = /^\d+\.([0-9a-f]{16})$/.exec(schemaVersion ?? '');
  return match ? match[1]! : null;
}
