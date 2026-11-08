import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { DataSource, type EntitySchema } from 'typeorm';
import { migrateDatabase, synchronizeSchema, type DatabaseDeployReport, type DeployTarget } from './db.deploy';
import { renderBaselineSql } from './db.baseline';
import { classifySyncStatements, setDefaultTarget, stripScratchSchema, type SchemaDrift } from './db.schema-drift';
import { parseDbUrl } from './db.utils';
import { WHERE_VALUE_BEHAVIOR } from './db.where-values';

/**
 * The database side of the baseline generator and the schema-drift check: a throwaway schema to build things in, and
 * "what would `synchronize` still do to this schema" as a list of SQL statements, without running any of them.
 * `generateBaselineSql` (the entities' DDL as the baseline file) and `checkSchemaDrift` (the entities against a schema
 * migrated from nothing) are the two uses.
 *
 * The scratch schema lives in the database the caller names (the same server the deploy runs against) under a random
 * `fleet_scratch_<hex>` name and is dropped when the callback ends, whatever happens. Nothing outside it is touched.
 */

type EntityList = ReadonlyArray<Function | EntitySchema>;

export const SCRATCH_SCHEMA_PREFIX = 'fleet_scratch_';

/** A schema name that cannot collide with a real one and is safe to put inside a quoted identifier. */
export function newScratchSchemaName(random: () => string = () => randomBytes(6).toString('hex')): string {
  const name = `${SCRATCH_SCHEMA_PREFIX}${random()}`;
  if (!/^[a-z0-9_]{1,63}$/.test(name)) throw new Error(`[db-scratch] invalid scratch schema name "${name}"`);
  return name;
}

/** Run `fn` with a freshly created, empty schema in the database of `url`; drop it afterwards (also when `fn` throws). */
export async function withScratchSchema<T>(url: string, fn: (schema: string) => Promise<T>): Promise<T> {
  const schema = newScratchSchemaName();
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    try {
      return await fn(schema);
    } finally {
      await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * The statements `synchronize` would run to bring `target` to the shape of `entities`, in the order it would run them,
 * exactly as TypeORM renders them (schema-qualified). Nothing is executed. Against an empty schema this is the complete
 * DDL of the entities; against a migrated schema it is the difference.
 *
 * A statement with bound parameters is never plain DDL (it is TypeORM bookkeeping such as `typeorm_metadata` rows): it
 * throws instead of being silently dropped, because a snapshot that skipped it would be incomplete.
 */
export async function logEntitySync(target: DeployTarget, entities: EntityList): Promise<string[]> {
  const ds = new DataSource({
    type: 'postgres',
    url: target.url,
    schema: target.schema,
    entities: [...entities],
    synchronize: false,
    logging: ['error'],
    invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR,
  });
  await ds.initialize();
  try {
    const { upQueries } = await ds.driver.createSchemaBuilder().log();
    return upQueries.map((q) => {
      if (q.parameters && q.parameters.length > 0) {
        throw new Error(`[db-scratch] synchronize would run a parameterised statement, which is not DDL: ${q.query.slice(0, 120)}`);
      }
      return q.query;
    });
  } finally {
    await ds.destroy();
  }
}

/**
 * The connection the scratch work uses: the same server as a deploy (`DATABASE_URL_UNPOOLED`, else `_ADMIN`, else
 * `DATABASE_URL`), whatever `FLEET_ROLE` says, because the scratch schema is created and dropped here and no application
 * data is read or written. The `?schema=` of the URL is ignored. Null when no database is configured.
 */
export function resolveScratchUrl(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const raw = env.DATABASE_URL_UNPOOLED || env.DATABASE_URL_ADMIN || env.DATABASE_URL;
  return raw ? parseDbUrl(raw).url : null;
}

/** The baseline file for `entities`: the DDL `synchronize` builds in an empty scratch schema, schema-neutral (db.baseline.ts). */
export async function generateBaselineSql(url: string, entities: EntityList): Promise<string> {
  return withScratchSchema(url, async (schema) => {
    const statements = await logEntitySync({ url, schema }, entities);
    return renderBaselineSql(statements, schema);
  });
}

export interface SchemaDriftCheck {
  /** The migration run that built the scratch schema from nothing (the baseline, then every module file). */
  migration: DatabaseDeployReport;
  /** What the entities still ask of that schema; null when the migrations themselves failed. */
  drift: SchemaDrift | null;
}

/**
 * Build a scratch schema from nothing the way a `migrate`-mode database is built (baseline first, then every module's
 * SQL files in order; contract steps allowed, there is no data and no window to protect; time-series skipped, it only
 * adds objects entities do not model), then ask which statements `synchronize` would still run for `entities`.
 *
 * A second scratch schema is built by `synchronize` itself and asked the same question: what TypeORM keeps wanting even
 * there (its jsonb default quirk) is not drift, so those statements are subtracted (db.schema-drift.ts).
 */
export async function checkSchemaDrift(url: string, entities: EntityList): Promise<SchemaDriftCheck> {
  const residual = async (schema: string): Promise<{ statements: string[]; defaults: Map<string, string | null> }> => ({
    statements: stripScratchSchema(await logEntitySync({ url, schema }, entities), schema),
    defaults: await columnDefaults(url, schema),
  });

  // One schema at a time, never nested: on a database without `uuid-ossp` the baseline installs the extension INTO its
  // scratch schema, where a second schema built while the first still exists could not see it.
  const migrated = await withScratchSchema(url, async (schema) => {
    const migration = await migrateDatabase({ url, schema }, { schemaMode: 'migrate', allowContract: true, includeTimeSeries: false });
    return { migration, left: migration.failed.length > 0 ? null : await residual(schema) };
  });
  if (migrated.left === null) return { migration: migrated.migration, drift: null };

  const reference = await withScratchSchema(url, async (schema) => {
    await synchronizeSchema({ url, schema }, { quiet: true, entities });
    return residual(schema);
  });
  // A statement that the reference needs too is TypeORM noise, except a SET DEFAULT on a column whose default differs
  // between the two schemas: there the migration really lacks (or changed) the default the entity declares.
  const sameDefault = (sql: string): boolean => {
    const target = setDefaultTarget(sql);
    return target === null || migrated.left!.defaults.get(target) === reference.defaults.get(target);
  };
  return { migration: migrated.migration, drift: classifySyncStatements(migrated.left.statements, reference.statements, sameDefault) };
}

/** `table.column` -> column default of every column of `schema` (what the catalog stores, null for none). */
async function columnDefaults(url: string, schema: string): Promise<Map<string, string | null>> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    const { rows } = await client.query<{ t: string; c: string; d: string | null }>(
      'SELECT table_name AS t, column_name AS c, column_default AS d FROM information_schema.columns WHERE table_schema = $1',
      [schema],
    );
    return new Map(rows.map((r) => [`${r.t}.${r.c}`, r.d]));
  } finally {
    await client.end().catch(() => undefined);
  }
}
