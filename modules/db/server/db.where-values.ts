import type { DataSourceOptions } from 'typeorm';

/**
 * How every DataSource this repo builds reads a `null` or `undefined` value in a where object (TypeORM
 * `invalidWhereValuesBehavior`).
 *
 * TypeORM 0.3.28's default for `null` is 'ignore': `where: { subjectId: x }` with `x === null` dropped the condition
 * and matched every row (metering 1.2 counted every subject that way). 'sql-null' makes it `subjectId IS NULL`, so a
 * stray null can only NARROW a query, never widen it across rows (or tenants). Code still says what it means:
 * `x ?? IsNull()` for "rows where it is NULL", or the key left out for "no filter" (`npm run check:null-where`).
 *
 * `undefined` stays 'ignore': an optional filter that was not given (`{ status: query.status }`) is skipped, which a
 * great deal of code relies on. A tenant id must therefore never be `undefined` in a where; the tenant-scoped helpers
 * take it as a required string.
 *
 * Note for update/delete/increment criteria and query-builder `.where({…})`: under 'ignore' a null there became
 * `col = NULL` (no row); under 'sql-null' it is `col IS NULL`.
 */
export const WHERE_VALUE_BEHAVIOR = {
  null: 'sql-null',
  undefined: 'ignore',
} as const satisfies NonNullable<DataSourceOptions['invalidWhereValuesBehavior']>;
