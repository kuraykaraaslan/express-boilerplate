/**
 * TypeORM CLI data source, for GENERATING a migration from the entity diff:
 *
 *   npm run db:migration:generate -- /tmp/<name>
 *
 * The output is a starting point for a hand-written SQL file, not something the
 * deploy runs: deploy-time schema changes are plain SQL files owned by modules
 * (`modules/<owner>/server/migrations/NNN_<name>.sql`, applied exactly once and
 * recorded with a checksum by `db.deploy.ts`), with `migrations: []` here and no
 * `db:migration:run` / `db:migration:revert`. A file declares its phase in its
 * leading comment (`-- kind: expand|migrate|contract; reversible: false`).
 *
 * Run through tsx (resolves TS + the `@/*` tsconfig path alias; the plain
 * `typeorm` CLI does neither):
 *   npx tsx ./node_modules/typeorm/cli.js migration:generate -d modules/db/server/db.migration-datasource.ts <path>
 */
import 'reflect-metadata';
// Must run before `./db` (which transitively imports `@/modules/env`) so .env is
// loaded before env validation executes at import time.
import 'dotenv/config';

import { DataSource } from 'typeorm';
import { parseDbUrl, resolveDbSslFromEnv } from './db.utils';
import { WHERE_VALUE_BEHAVIOR } from './db.where-values';
import { ENTITIES } from './db';

// Migrations are DDL: prefer the direct (unpooled) connection — a PgBouncer /
// Neon pooled connection is transaction-scoped and unsuited to migrations.
const DATABASE_URL = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error('[db.migration-datasource] DATABASE_URL (or DATABASE_URL_UNPOOLED) is required');

const { url: plainUrl, schema } = parseDbUrl(DATABASE_URL);
// 38-security 7.6: the same TLS rule as the runtime connection.
const { url, ssl } = resolveDbSslFromEnv(plainUrl);

export const MigrationDataSource = new DataSource({
  type: 'postgres',
  url,
  ssl,
  schema,
  synchronize: false,
  logging: ['migration', 'error'],
  entities: ENTITIES,
  invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR,
  // Deploy-time SQL migrations are owned by modules and run through db.deploy.
  migrations: [],
});

export default MigrationDataSource;
