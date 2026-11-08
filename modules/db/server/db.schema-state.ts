/**
 * The schema version a database was last brought to, recorded by the deploy runner in `_schema_state` (one row per
 * database, next to the `_sql_migrations` ledger). `/internal/api/ready` reads it back so an operator can compare the
 * applied version with the one the running code expects (`codeSchemaVersion`); the deploy fan-out copies it to
 * `tenant_databases.schemaVersion`.
 *
 * Both functions take a minimal `query` interface (a `pg` client, a TypeORM DataSource) so they are testable without a
 * driver. Reading is tolerant by contract: a missing table, a missing grant or a dead connection is "unknown" (null),
 * never an error, because a readiness probe must report on the database, not fail with it.
 */

export interface SchemaStateQueryable {
  query(sql: string, params?: unknown[]): Promise<unknown>;
}

const ENSURE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS _schema_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  schema_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  applied_by text,
  release text
)`;

const UPSERT_SQL = `INSERT INTO _schema_state (id, schema_version, applied_at, applied_by, release)
VALUES (true, $1, now(), COALESCE($2::text, current_user::text), $3)
ON CONFLICT (id) DO UPDATE SET schema_version = EXCLUDED.schema_version, applied_at = EXCLUDED.applied_at,
  applied_by = EXCLUDED.applied_by, release = EXCLUDED.release`;

/** Record `schemaVersion` as the applied version of the database behind `db` (creates the table on first use). */
export async function stampSchemaState(
  db: SchemaStateQueryable,
  schemaVersion: string,
  identity: { actor: string | null; release: string | null },
): Promise<void> {
  await db.query(ENSURE_TABLE_SQL);
  await db.query(UPSERT_SQL, [schemaVersion, identity.actor, identity.release]);
}

/** The recorded applied version, or null when there is none or it cannot be read. */
export async function readAppliedSchemaVersion(db: SchemaStateQueryable): Promise<string | null> {
  try {
    const result = await db.query('SELECT schema_version FROM _schema_state WHERE id = true');
    const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] } | null)?.rows;
    const value = (rows?.[0] as { schema_version?: unknown } | undefined)?.schema_version;
    return typeof value === 'string' && value !== '' ? value : null;
  } catch {
    return null;
  }
}
