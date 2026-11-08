/**
 * db.04: the deploy target's schema name is interpolated into DDL (`DROP SCHEMA`, `CREATE SCHEMA`, `SET search_path`), where a
 * bind parameter cannot stand. A schema name is therefore an ordinary lower-case Postgres identifier (letters, digits, `_`, at
 * most 63 characters), refused otherwise, and quoted with any `"` doubled as a second line.
 */
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/;

export function assertSafeSchemaName(schema: string | null | undefined): void {
  if (schema === undefined || schema === null || schema === '') return;
  if (!SCHEMA_RE.test(schema)) throw new Error(`[db-deploy] unsafe schema name ${JSON.stringify(schema)}: use a lower-case identifier`);
}

export function quoteSchema(schema: string): string {
  assertSafeSchemaName(schema);
  return `"${schema.replace(/"/g, '""')}"`;
}
