import 'reflect-metadata';
import bcrypt from 'bcrypt';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { DataSource, type EntitySchema } from 'typeorm';
import { ENTITIES } from '@kuraykaraaslan-labs/db';
import { ROOT_TENANT_ID, ROOT_TENANT_NAME, SEED_TENANT_ID, SEED_TENANT_NAME, assertTenantIdAllowed } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { ensureFleetTenant } from './db.fleet-tenant';
import { codeSchemaVersion } from './db.schema-version';
import { stampSchemaState } from './db.schema-state';
import { assertPlaintextDropSafe, backfillTenantDatabaseUrls, clearPlaintextTenantDatabaseUrls } from './db.tenant-database.backfill';
import { assertSafeSchemaName, quoteSchema } from './db.schema-ident';
import { ciphertextOnlyRole } from './db.tenant-database.url';
import { loadModuleMigrations } from './db.migration-files';
import { postDeploy, type PostDeployOutcome } from './db.post-deploy';
import { WHERE_VALUE_BEHAVIOR } from './db.where-values';
import { BASELINE_NAME, BASELINE_REFUSAL, decideBaselineAction } from './db.baseline';
import {
  checkPendingPlan,
  classifyAgainstLedger,
  planAllMigrations,
  type PendingPlanDecision,
} from './db.migration-plan';
import {
  resolveDeployIdentity,
  resolveLockTimeoutMs,
  resolveSchemaMode,
  resolveSeedEnabled,
  type SchemaMode,
} from './db.deploy-mode';
import { User } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { TenantMember } from '@kuraykaraaslan-labs/tenant_member/server/entities/tenant_member.entity';
// Type only: tenant_domain requires db, and an edition may not have it. The seed reaches its table by entity name.
import type { TenantDomain } from '@kuraykaraaslan-labs/tenant_domain/server/entities/tenant_domain.entity';
import { Setting } from '@kuraykaraaslan-labs/tenant_setting/server/entities/setting.entity';

/**
 * Shared deploy pipeline, used by the build-time `modules/db/scripts/db-deploy.ts` and the
 * serverless demo-reset cron. It runs over the direct (unpooled) connection,
 * under one advisory lock per database, in this order:
 *
 *   1. Schema        - `synchronize` mode (single role, dev, Vercel: today's
 *                      behaviour) creates/alters tables from the TypeORM
 *                      entities, which is also what creates `tenant_databases`
 *                      et al. (the runtime DataSource never synchronizes outside
 *                      development). `migrate` mode (the default for the `node`
 *                      and `fleet` roles, or `DB_DEPLOY_MODE=migrate`) skips it:
 *                      the ledger is the truth. See db.deploy-mode.ts.
 *   2. SQL migrations - each module's `modules/<id>/server/migrations/*.sql`,
 *                      (the baseline `db:000_baseline.sql` first, db.baseline.ts)
 *                      applied exactly once as `<module>:<file>` in the
 *                      `_sql_migrations` ledger, with a sha256 checksum, the
 *                      applying role and the release. An applied file that was
 *                      edited fails the run (fail closed) unless it declares
 *                      `-- repeatable: true`, or lists the applied checksum in
 *                      `-- supersedes: <sha256>` (an edit that is a no-op for a
 *                      database that ran the old text: the row is re-stamped). A file declares its phase with
 *                      `-- kind: expand|migrate|contract` (db.migration-plan.ts);
 *                      a pending `contract` step is refused unless the caller
 *                      passes `allowContract`.
 *   3. Time-series    - hypertables / fallback indexes for declared tables.
 *      Then, once all of that succeeded, the schema version of this code is
 *      recorded in `_schema_state` (what `/internal/api/ready` reports as the
 *      applied version).
 *   4. Backfill       - `deployDatabase` only: fills `tenant_databases.databaseUrlEnc`
 *                      from the plaintext column when an encryption key is
 *                      configured (db.tenant-database.backfill.ts); on
 *                      FLEET_ROLE=node|fleet it then clears the plaintext of
 *                      every row whose ciphertext opens to it (P9-6).
 *   5. Bootstrap seed - ONLY on a fresh database (no tenant rows), and only when
 *                      the role allows it (never for `node` / `fleet`): creates
 *                      the PLATFORM (root) and ACME (demo) tenants plus their
 *                      users. The fleet tenant row is ensured on every deploy.
 *   6. Post-deploy    - `deployDatabase` only, every deploy: the idempotent steps
 *                      other modules contribute to `db:post_deploy` (dashboard's
 *                      builtin widget publish), best effort (db.post-deploy.ts).
 *
 * `migrateDatabase()` is the per-database, reportable unit (steps 1-3, no seed)
 * that returns a `DatabaseDeployReport`; `deployDatabase()` adds the seed and
 * throws when a migration failed. `dropSchema()` adds the destructive reset used
 * by demo mode: it wipes the schema so the subsequent `deployDatabase()`
 * rebuilds everything and the seed runs in full again. `fanOutDeploy()`
 * (db.deploy.fan-out.ts) runs `migrateDatabase` over every dedicated tenant
 * database.
 */

export interface DeployTarget {
  url: string;
  schema?: string;
}

export interface DeployOptions {
  /** Defaults to `DB_DEPLOY_MODE`, else the role default (`migrate` for node/fleet, `synchronize` otherwise). */
  schemaMode?: SchemaMode;
  /** Permit pending `contract` migrations. Set only by the node helper inside a READ_ONLY window after the backup. */
  allowContract?: boolean;
  /** Run the time-series phase (default true). */
  includeTimeSeries?: boolean;
  /** Longest wait for another deploy holding the lock. Defaults to `DB_DEPLOY_LOCK_TIMEOUT_MS`, else 10 minutes. */
  lockTimeoutMs?: number;
  /** Delay between lock attempts (default 2000). */
  lockPollMs?: number;
  /**
   * Fan-out only: after a tenant database migrated cleanly, run the `db:post_deploy` steps that declare
   * `metadata.tenantDatabases: true` against it (db.post-deploy.ts). Set by the deploy script; off by default.
   */
  tenantPostDeploy?: boolean;
}

export interface DatabaseDeployReport {
  /** `host:port/db[#schema]`, never the credentials. */
  database: string;
  schemaMode: SchemaMode;
  /** Ledger names applied (or re-applied, for a repeatable file) by this run. */
  applied: string[];
  /** Ledger names already applied and unchanged (includes the stamped ones). */
  skipped: string[];
  /** The baseline, when a sync pass of this run had already built its schema: recorded in the ledger without being run. */
  adopted: string[];
  /**
   * Applied rows whose checksum was rewritten from the current file without running it: rows with no checksum
   * (trust-on-first-use) and rows carrying a checksum the file declares it `supersedes`.
   */
  stamped: string[];
  /** Why the run stopped. Empty on success; migrations after the first failure are not attempted. */
  failed: Array<{ name: string; message: string }>;
  /** The schema version recorded in `_schema_state` by this run; null when it failed or the version cannot be known. */
  schemaVersion: string | null;
  durationMs: number;
  /** `deployDatabase` only: the outcome of each `db:post_deploy` step (a failed step does not fail the deploy). */
  postDeploy?: PostDeployOutcome[];
}

// Demo bootstrap credentials. Change these in production after the first login.
export const SEED_USERS = {
  sysadmin: { email: 'sysadmin@kuray.dev', password: 'sysadmin123456' },
  acmeAdmin: { email: 'admin@kuray.dev', password: 'admin123456' },
  acmeUser: { email: 'user@kuray.dev', password: 'user123456' },
} as const;
/**
 * The first deploy of a PRODUCTION database (F.db.01) never uses the demo credentials above, which are published in this
 * repository: the platform sysadmin gets the operator's `SEED_SYSADMIN_PASSWORD` (12+ characters) or, without one, a random
 * password that is never printed (sign in through the password reset). The ACME demo tenant and its users are not created, the
 * root tenant's `adminRequireMfa` is left as it is, and no password reaches the deploy log.
 */
/**
 * The wildcard domain the seed builds primary hosts under, without a `:port` (tenant_domain.11): the proxy strips the port of
 * the Host header before it looks a host up, so `acme.localhost:3000` was stored and never matched.
 */
function seedWildcard(): string {
  return (process.env.NEXT_PUBLIC_TENANT_WILDCARD_DOMAIN || process.env.TENANT_WILDCARD_DOMAIN || '').trim().toLowerCase().replace(/:\d+$/, '')
}

function isProductionSeed(): boolean {
  return process.env.NODE_ENV === 'production';
}

function productionSysadminPassword(): string {
  const chosen = process.env.SEED_SYSADMIN_PASSWORD;
  if (chosen && chosen.length >= 12 && !Object.values(SEED_USERS).some((u) => u.password === chosen)) return chosen;
  return randomBytes(24).toString('base64url');
}

// Lives in db.utils (pure, no env/entities) so it can be unit-tested; re-exported
// here because the deploy script and the demo-reset cron import it from this file.
export { resolveDeployTarget } from '@kuraykaraaslan-labs/db/server/db.utils';

/**
 * Destructive: drop and recreate the target schema, wiping all data. Used only
 * by demo mode — guarded by callers behind DEMO_MODE.
 */
export async function dropSchema(target: DeployTarget): Promise<void> {
  const { url, schema } = target;
  const schemaName = schema || 'public';
  const ident = quoteSchema(schemaName); // db.04: refused before any connection
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(`DROP SCHEMA IF EXISTS ${ident} CASCADE`);
    await client.query(`CREATE SCHEMA ${ident}`);
    console.log(`[db-deploy] dropped and recreated schema "${schemaName}".`);
  } finally {
    await client.end();
  }
}

/** `host:port/db[#schema]` for reports and logs: never the user, the password or the query string. */
export function describeDatabase(target: DeployTarget): string {
  let label: string;
  try {
    const u = new URL(target.url);
    label = `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    label = '<unparseable url>';
  }
  return target.schema ? `${label}#${target.schema}` : label;
}

/**
 * Bring the schema of `target` to the shape of the entities (TypeORM `synchronize`). Ignores `DB_DEPLOY_SYNC`. A deploy
 * logs every schema change TypeORM makes; `quiet` keeps only errors and `entities` replaces the application's entity list
 * (both for scratch schemas built for a comparison).
 */
export async function synchronizeSchema(
  target: DeployTarget,
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM's own entity list type
  opts: { quiet?: boolean; entities?: ReadonlyArray<Function | EntitySchema> } = {},
): Promise<void> {
  const ds = new DataSource({
    type: 'postgres',
    url: target.url,
    schema: target.schema,
    entities: opts.entities ? [...opts.entities] : ENTITIES,
    synchronize: true,
    logging: opts.quiet ? ['error'] : ['error', 'schema'],
    invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR,
  });
  await ds.initialize();
  try {
    console.log('[db-deploy] schema synchronized from entities.');
  } finally {
    await ds.destroy();
  }
}

/** The `synchronize` mode step: true when a sync pass ran (it can be switched off with `DB_DEPLOY_SYNC=false`). */
async function syncSchema(target: DeployTarget): Promise<boolean> {
  if (process.env.DB_DEPLOY_SYNC === 'false') {
    console.log('[db-deploy] schema synchronization disabled (DB_DEPLOY_SYNC=false).');
    return false;
  }
  await synchronizeSchema(target);
  return true;
}

/**
 * Record the schema version of this code as the applied version of the target. Bookkeeping for the health probes and
 * the fleet, so it never fails a deploy that otherwise succeeded: an unknown version or a write error is a warning.
 */
async function recordAppliedSchema(target: DeployTarget): Promise<string | null> {
  const version = await codeSchemaVersion();
  if (!version) {
    console.warn('[db-deploy] the schema version of this code cannot be determined; the applied version is not recorded.');
    return null;
  }
  const { actor, release } = resolveDeployIdentity(process.env);
  const client = new Client({ connectionString: target.url });
  try {
    await client.connect();
    if (target.schema) await client.query(`SET search_path TO ${quoteSchema(target.schema)}`);
    await stampSchemaState(client, version.schemaVersion, { actor, release });
    return version.schemaVersion;
  } catch (err) {
    console.warn(`[db-deploy] could not record the applied schema version: ${(err as Error).message}`);
    return null;
  } finally {
    await client.end().catch(() => undefined);
  }
}

/** db.02: run `assertPlaintextDropSafe` on the target (a refusal throws and stops the deploy before the schema step). */
async function guardTenantDatabasePlaintextDrop(target: DeployTarget, refuse: boolean): Promise<void> {
  const client = new Client({ connectionString: target.url });
  try {
    await client.connect();
    if (target.schema) await client.query(`SET search_path TO ${quoteSchema(target.schema)}, public`);
    const { backfilled } = await assertPlaintextDropSafe(client, undefined, { refuse });
    if (backfilled > 0) console.log(`[db-deploy] encrypted ${backfilled} tenant database URL(s) before dropping the plaintext column.`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Fill `tenant_databases.databaseUrlEnc` for rows that only have the plaintext DSN. A failure is a warning: such a row
 * keeps working through the plaintext fallback, and the next deploy tries again.
 */
async function backfillTenantDatabases(target: DeployTarget): Promise<void> {
  const client = new Client({ connectionString: target.url });
  try {
    await client.connect();
    if (target.schema) await client.query(`SET search_path TO ${quoteSchema(target.schema)}, public`);
    const result = await backfillTenantDatabaseUrls(client);
    if (result.skipped === 'no-key') {
      console.log('[db-deploy] SETTINGS_ENCRYPTION_KEY not configured: tenant database URLs stay plaintext-only.');
    } else if (result.encrypted > 0) {
      console.log(`[db-deploy] encrypted ${result.encrypted} tenant database URL(s).`);
    }
    // P9-6: the fleet roles keep the ciphertext only (`ciphertextOnlyRole`); a row whose ciphertext does not open to its plaintext keeps it.
    if (ciphertextOnlyRole(process.env.FLEET_ROLE)) {
      const clear = await clearPlaintextTenantDatabaseUrls(client);
      if (clear.cleared > 0) console.log(`[db-deploy] cleared the plaintext of ${clear.cleared} tenant database URL(s).`);
      if (clear.kept > 0) console.warn(`[db-deploy] ${clear.kept} tenant database URL(s) keep their plaintext: the ciphertext does not open to it with this key.`);
    }
  } catch (err) {
    console.warn(`[db-deploy] tenant database URL backfill failed: ${(err as Error).message}`);
  } finally {
    await client.end().catch(() => undefined);
  }
}

const PLAN_REFUSALS: Record<PendingPlanDecision, string> = {
  REJECTED_PHASE_ORDER: 'pending migrations are not in expand -> migrate -> contract order',
  REJECTED_CONTRACT_NOT_ALLOWED:
    'a pending contract migration is destructive and runs only when explicitly allowed (a READ_ONLY maintenance window after the backup)',
};

/** Create (or upgrade) the `_sql_migrations` ledger in the schema `client` is already pointed at. */
export async function ensureMigrationLedger(client: Client): Promise<void> {
  await client.query(
    `CREATE TABLE IF NOT EXISTS _sql_migrations (
       name text PRIMARY KEY,
       module_id text NOT NULL DEFAULT 'legacy',
       file_name text NOT NULL DEFAULT '',
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await client.query('ALTER TABLE _sql_migrations ADD COLUMN IF NOT EXISTS module_id text NOT NULL DEFAULT \'legacy\'');
  await client.query('ALTER TABLE _sql_migrations ADD COLUMN IF NOT EXISTS file_name text NOT NULL DEFAULT \'\'');
  // NULL on every row written before checksums existed; see classifyAgainstLedger for how those are treated.
  await client.query(
    'ALTER TABLE _sql_migrations ADD COLUMN IF NOT EXISTS checksum text, '
    + 'ADD COLUMN IF NOT EXISTS applied_by text, ADD COLUMN IF NOT EXISTS release text',
  );
}

/** Add the ledger row of a migration whose effect is already in the database, without executing the file. */
export async function recordMigrationApplied(
  client: Client,
  file: { name: string; moduleId: string; file: string },
  checksum: string,
): Promise<void> {
  const { actor, release } = resolveDeployIdentity(process.env);
  await client.query(
    'INSERT INTO _sql_migrations (name, module_id, file_name, checksum, applied_by, release) '
    + 'VALUES ($1, $2, $3, $4, COALESCE($5::text, current_user::text), $6)',
    [file.name, file.moduleId, file.file, checksum, actor, release],
  );
}

/** Whether the current schema holds tables besides the deploy bookkeeping ones: an established database, not an empty one. */
async function hasEntityTables(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = current_schema() AND table_type = 'BASE TABLE'
         AND table_name NOT IN ('_sql_migrations', '_schema_state')
     ) AS found`,
  );
  return rows[0]?.found === true;
}

/**
 * Apply the pending SQL migrations of every module against the `_sql_migrations`
 * ledger and record the outcome in `report`. A per-migration problem (an edited
 * applied file, a refused plan, a failing SQL file) is reported in `report.failed`
 * and stops the run before anything later is applied; a failing file is rolled
 * back. A connection error throws.
 */
async function applySqlMigrations(
  target: DeployTarget,
  opts: Required<Pick<DeployOptions, 'allowContract'>> & { synchronized: boolean },
  report: DatabaseDeployReport,
): Promise<void> {
  const files = loadModuleMigrations();
  if (files.length === 0) return;
  // Parsed before any connection is opened: a malformed header is a defect in the repo, not a database problem.
  planAllMigrations(files);
  const byName = new Map(files.map((f) => [f.name, f]));
  const { actor, release } = resolveDeployIdentity(process.env);

  const { url, schema } = target;
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    if (schema) {
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteSchema(schema)}`);
      await client.query(`SET search_path TO ${quoteSchema(schema)}`);
    }
    await ensureMigrationLedger(client);

    const { rows } = await client.query<{ name: string; checksum: string | null }>(
      'SELECT name, checksum FROM _sql_migrations',
    );
    const cls = classifyAgainstLedger(files, new Map(rows.map((r) => [r.name, r.checksum ?? null])));

    if (cls.mismatched.length > 0) {
      for (const m of cls.mismatched) {
        report.failed.push({
          name: m.name,
          message: `applied file was modified (stored checksum ${m.stored}, file checksum ${m.found})`,
        });
      }
      return;
    }
    const baseline = cls.pending.find((m) => m.name === BASELINE_NAME);
    if (baseline) {
      const action = decideBaselineAction({
        pending: true,
        synchronized: opts.synchronized,
        hasTables: opts.synchronized ? false : await hasEntityTables(client),
      });
      if (action === 'refuse') {
        report.failed.push({ name: BASELINE_NAME, message: BASELINE_REFUSAL });
        return;
      }
      if (action === 'record') {
        await recordMigrationApplied(client, byName.get(BASELINE_NAME)!, baseline.checksum);
        report.adopted.push(BASELINE_NAME);
        console.log(`[db-deploy] recorded ${BASELINE_NAME} without running it (the schema was just synchronized from the entities).`);
        cls.pending.splice(cls.pending.indexOf(baseline), 1);
      }
    }
    // A pending contract step refuses the whole deploy without `--allow-contract`, in every schema mode (db.02: the release
    // that drops the plaintext tenant database URL is deployed once with the flag, single role included).
    const refusal = checkPendingPlan(cls.pending, { allowContract: opts.allowContract });
    if (refusal) {
      const culprit = refusal === 'REJECTED_CONTRACT_NOT_ALLOWED'
        ? cls.pending.find((m) => m.kind === 'contract')!.name
        : cls.pending.map((m) => m.name).join(', ');
      report.failed.push({ name: culprit, message: `${refusal}: ${PLAN_REFUSALS[refusal]}` });
      return;
    }

    for (const row of cls.stamp) {
      // Conditional on the checksum just read, so a row another deploy changed meanwhile is left alone.
      await client.query(
        'UPDATE _sql_migrations SET checksum = $2 WHERE name = $1 AND checksum IS NOT DISTINCT FROM $3',
        [row.name, row.checksum, row.from],
      );
      report.stamped.push(row.name);
      console.log(row.from === null
        ? `[db-deploy] stamped checksum of ${row.name} (applied before checksums; current file trusted).`
        : `[db-deploy] stamped checksum of ${row.name} (the file declares it supersedes the applied version).`);
    }
    report.skipped.push(...cls.skipped, ...cls.stamp.map((r) => r.name));
    for (const name of cls.skipped) console.log(`[db-deploy] skip ${name} (already applied).`);

    for (const migration of cls.pending) {
      const file = byName.get(migration.name)!;
      console.log(`[db-deploy] ${migration.reason === 'new' ? 'applying' : 're-applying'} ${migration.name} (${migration.kind}) ...`);
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        if (migration.reason === 'new') {
          await recordMigrationApplied(client, file, migration.checksum);
        } else {
          await client.query(
            'UPDATE _sql_migrations SET checksum = $2, applied_by = COALESCE($3::text, current_user::text), release = $4, '
            + 'applied_at = now() WHERE name = $1',
            [migration.name, migration.checksum, actor, release],
          );
        }
        await client.query('COMMIT');
        report.applied.push(migration.name);
        console.log(`[db-deploy] applied ${migration.name}.`);
      } catch (err) {
        await client.query('ROLLBACK');
        report.failed.push({ name: migration.name, message: (err as Error).message });
        return;
      }
    }
  } finally {
    await client.end();
  }
}

/**
 * Deploy phase 3 (docs/phases/10-db phase 5): after the schema step and the SQL
 * migrations, turn every declared time-series table into a hypertable (when the
 * extension is installed) or give it the fallback indexes. No declarations =
 * no-op. Needs the admin credential (create_hypertable / policies).
 */
async function ensureTimeSeries(target: DeployTarget): Promise<void> {
  const { loadTimeSeriesTables, ensureTimeSeriesTables } = await import('./db.time-series');
  const { ensureTimescaleExtension } = await import('./db.timescale');

  const client = new Client({ connectionString: target.url });
  await client.connect();
  try {
    if (target.schema) await client.query(`SET search_path TO ${quoteSchema(target.schema)}, public`);
    // Optional capability: a NOTICE, never a failure, when the server cannot offer it.
    await ensureTimescaleExtension(client);
    const tables = await loadTimeSeriesTables();
    if (tables.length === 0) return;
    for (const report of await ensureTimeSeriesTables(client, tables)) {
      console.log(`[db-deploy] time-series ${report.table}: ${report.mode} (${report.actions.join(', ') || 'unchanged'})`);
    }
  } finally {
    await client.end();
  }
}

/**
 * Bootstrap seed — runs ONLY when the database has no tenants yet, so it is a
 * true first-deploy step and never mutates an established database.
 *
 *   PLATFORM (root tenant)   → sysadmin@kuray.dev   ADMIN (super-admin)
 *   ACME     (demo tenant)   → admin@kuray.dev      OWNER
 *                              user@kuray.dev       USER
 */
async function seedIfFresh(target: DeployTarget): Promise<void> {
  const ds = new DataSource({
    type: 'postgres',
    url: target.url,
    schema: target.schema,
    entities: ENTITIES,
    synchronize: false,
    logging: ['error'],
    invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR,
  });
  await ds.initialize();
  try {
    const tenantRepo = ds.getRepository(Tenant);
    const tenantCount = await tenantRepo.count();
    if (tenantCount > 0) {
      console.log(`[db-deploy] ${tenantCount} tenant(s) present — skipping bootstrap seed.`);
      return;
    }

    const production = isProductionSeed();
    console.log(production
      ? '[db-deploy] fresh PRODUCTION database — seeding the PLATFORM tenant and its sysadmin (no demo tenant).'
      : '[db-deploy] fresh database — seeding PLATFORM + ACME tenants.');

    const userRepo = ds.getRepository(User);
    const memberRepo = ds.getRepository(TenantMember);

    // ── Tenants ──────────────────────────────────────────────────────────────
    const platform = await tenantRepo.save(tenantRepo.create({
      tenantId: ROOT_TENANT_ID,
      name: ROOT_TENANT_NAME,
      description: 'Root tenant — owns platform configuration and super-admin surface',
      tenantStatus: 'ACTIVE',
    }));
    if (production) {
      const sysadmin = await userRepo.save(userRepo.create({
        email: SEED_USERS.sysadmin.email,
        password: await bcrypt.hash(productionSysadminPassword(), 10),
        userRole: 'ADMIN',
        userStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      }));
      await memberRepo.save(memberRepo.create({ tenantId: platform.tenantId, userId: sysadmin.userId, memberRole: 'ADMIN', memberStatus: 'ACTIVE' }));
      const prodWildcard = seedWildcard();
      if (prodWildcard && ds.hasMetadata('TenantDomain')) {
        const domainRepo = ds.getRepository<TenantDomain>('TenantDomain');
        await domainRepo.save(domainRepo.create({
          tenantId: platform.tenantId, domain: `${process.env.TENANT_DEFAULT_SUBDOMAIN || 'system'}.${prodWildcard}`, isPrimary: true, domainStatus: 'ACTIVE',
        }));
      }
      console.log(`[db-deploy] seeded PLATFORM (${platform.tenantId}) ADMIN ${SEED_USERS.sysadmin.email}; the password is ${process.env.SEED_SYSADMIN_PASSWORD ? 'SEED_SYSADMIN_PASSWORD' : 'random and not shown: use the password reset'}.`);
      return;
    }
    // Outside the platform range (phase 46, D46-5): until 2026-10-27 this row took the fleet tenant's id.
    assertTenantIdAllowed(SEED_TENANT_ID, 'the demo tenant');
    const acme = await tenantRepo.save(tenantRepo.create({
      tenantId: SEED_TENANT_ID,
      name: SEED_TENANT_NAME,
      description: 'Example tenant created by the bootstrap seed',
      tenantStatus: 'ACTIVE',
    }));

    // ── Users ────────────────────────────────────────────────────────────────
    const makeUser = async (creds: { email: string; password: string }, userRole: 'ADMIN' | 'USER') =>
      userRepo.save(userRepo.create({
        email: creds.email,
        password: await bcrypt.hash(creds.password, 10),
        userRole,
        userStatus: 'ACTIVE',
        emailVerifiedAt: new Date(),
      }));
    const sysadmin = await makeUser(SEED_USERS.sysadmin, 'ADMIN');
    const acmeAdmin = await makeUser(SEED_USERS.acmeAdmin, 'USER');
    const acmeUser = await makeUser(SEED_USERS.acmeUser, 'USER');

    // ── Memberships ────────────────────────────────────────────────────────────
    const addMember = (tenantId: string, userId: string, memberRole: 'ADMIN' | 'OWNER' | 'USER') =>
      memberRepo.save(memberRepo.create({ tenantId, userId, memberRole, memberStatus: 'ACTIVE' }));
    await addMember(platform.tenantId, sysadmin.userId, 'ADMIN');
    await addMember(acme.tenantId, acmeAdmin.userId, 'OWNER');
    await addMember(acme.tenantId, acmeUser.userId, 'USER');

    // ── Primary domains (only when a wildcard domain is configured) ────────────
    // By entity name: an edition without tenant_domain has no such entity in ENTITIES, and skips domain seeding.
    const wildcard = seedWildcard();
    if (wildcard && ds.hasMetadata('TenantDomain')) {
      const domainRepo = ds.getRepository<TenantDomain>('TenantDomain');
      const rootSub = process.env.TENANT_DEFAULT_SUBDOMAIN || 'system';
      await domainRepo.save(domainRepo.create({
        tenantId: platform.tenantId, domain: `${rootSub}.${wildcard}`, isPrimary: true, domainStatus: 'ACTIVE',
      }));
      await domainRepo.save(domainRepo.create({
        tenantId: acme.tenantId, domain: `acme.${wildcard}`, isPrimary: true, domainStatus: 'ACTIVE',
      }));
    }

    // ── Bootstrap setting: don't force MFA on the root super-admin's first login ─
    const settingRepo = ds.getRepository(Setting);
    await settingRepo.save(settingRepo.create({
      tenantId: ROOT_TENANT_ID, key: 'adminRequireMfa', value: 'false', group: 'auth', type: 'boolean',
    }));

    console.log('[db-deploy] seeded:');
    console.log(`  PLATFORM (${platform.tenantId})  ADMIN  ${SEED_USERS.sysadmin.email} / ${SEED_USERS.sysadmin.password}`);
    console.log(`  ACME     (${acme.tenantId})  OWNER  ${SEED_USERS.acmeAdmin.email} / ${SEED_USERS.acmeAdmin.password}`);
    console.log(`  ACME     (${acme.tenantId})  USER   ${SEED_USERS.acmeUser.email} / ${SEED_USERS.acmeUser.password}`);
  } finally {
    await ds.destroy();
  }
}

/** Every-deploy step: the fleet tenant row must exist on fresh AND established databases, and be the fleet tenant (phase 46). */
async function seedFleetTenant(target: DeployTarget): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url: target.url, schema: target.schema, entities: ENTITIES, synchronize: false, logging: ['error'], invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR });
  await ds.initialize();
  try {
    // A row at the fleet id that is a customer (the pre-phase-46 seed's Acme) stops the deploy here, naming tenant:rekey (D46-5).
    const result = await ensureFleetTenant(ds.getRepository(Tenant), {
      members: (tenantId) => ds.getRepository(TenantMember).count({ where: { tenantId }, withDeleted: true }),
      // By entity name, as the seed does: an edition without tenant_domain has no domains to count.
      domains: async (tenantId) => (ds.hasMetadata('TenantDomain') ? ds.getRepository<TenantDomain>('TenantDomain').count({ where: { tenantId }, withDeleted: true }) : 0),
      controlPlane: process.env.FLEET_ROLE === 'fleet',
    });
    if (result === 'created') console.log('[db-deploy] seeded fleet tenant.');
  } finally {
    await ds.destroy();
  }
}

const LOCK_KEY = 'next-boilerplate:db-deploy';
const LOCK_LOG_EVERY_MS = 10_000;

async function acquireDeployLock(
  client: Client,
  label: string,
  timeoutMs: number,
  pollMs: number,
): Promise<void> {
  const started = Date.now();
  let lastLog = started;
  let announced = false;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)::bigint) AS locked',
      [LOCK_KEY],
    );
    if (rows[0]?.locked === true) return;
    const waited = Date.now() - started;
    if (waited >= timeoutMs) {
      throw new Error(`[db-deploy] could not take the deploy lock on ${label} within ${timeoutMs} ms: another deploy is running.`);
    }
    if (!announced || Date.now() - lastLog >= LOCK_LOG_EVERY_MS) {
      console.log(`[db-deploy] waiting for another deploy on ${label} (${Math.round(waited / 1000)} s so far) ...`);
      announced = true;
      lastLog = Date.now();
    }
    await new Promise((resolve) => setTimeout(resolve, Math.min(pollMs, timeoutMs - waited)));
  }
}

/** Run `fn` while holding the deploy advisory lock of the target database (one deploy per database at a time). */
export async function withDeployLock<T>(target: DeployTarget, opts: DeployOptions, fn: () => Promise<T>): Promise<T> {
  const lockClient = new Client({ connectionString: target.url });
  await lockClient.connect();
  try {
    await acquireDeployLock(
      lockClient,
      describeDatabase(target),
      opts.lockTimeoutMs ?? resolveLockTimeoutMs(process.env),
      opts.lockPollMs ?? 2000,
    );
    try {
      return await fn();
    } finally {
      // The lock dies with the connection anyway; a failed unlock must not hide the run's own error.
      await lockClient
        .query('SELECT pg_advisory_unlock(hashtext($1)::bigint)', [LOCK_KEY])
        .catch((err: unknown) => console.warn(`[db-deploy] could not release the deploy lock: ${(err as Error).message}`));
    }
  } finally {
    await lockClient.end();
  }
}

/** Steps 1-3 of the pipeline, lock already held. Does not seed. */
async function runMigrationSteps(target: DeployTarget, opts: DeployOptions): Promise<DatabaseDeployReport> {
  const started = Date.now();
  const schemaMode = opts.schemaMode ?? resolveSchemaMode(process.env).mode;
  const report: DatabaseDeployReport = {
    database: describeDatabase(target),
    schemaMode,
    applied: [], skipped: [], adopted: [], stamped: [], failed: [],
    schemaVersion: null,
    durationMs: 0,
  };
  let synchronized = false;
  // db.02: before ANY schema change (synchronize drops the plaintext column the entity no longer has; migration 007 does
  // the same in migrate mode), every tenant database URL gets its ciphertext, or the deploy stops here.
  await guardTenantDatabasePlaintextDrop(target, schemaMode === 'synchronize');
  if (schemaMode === 'synchronize') {
    synchronized = await syncSchema(target);
  } else {
    console.log('[db-deploy] migrate mode: schema is changed by SQL migrations only (no synchronize).');
  }
  await applySqlMigrations(target, { allowContract: opts.allowContract === true, synchronized }, report);
  if (report.failed.length === 0 && opts.includeTimeSeries !== false) await ensureTimeSeries(target);
  if (report.failed.length === 0) report.schemaVersion = await recordAppliedSchema(target);
  report.durationMs = Date.now() - started;
  return report;
}

/**
 * The per-database, reportable unit: lock, schema (per mode), SQL migrations,
 * time-series. No seed. A failing migration is returned in `report.failed`
 * instead of thrown (the caller decides: `deployDatabase` throws, a fan-out
 * over many databases keeps going and reports each); a connection or lock error
 * still throws.
 */
export async function migrateDatabase(target: DeployTarget, opts: DeployOptions = {}): Promise<DatabaseDeployReport> {
  return withDeployLock(target, opts, () => runMigrationSteps(target, opts));
}

/**
 * Idempotent deploy: schema (per mode) -> SQL migrations -> time-series ->
 * seed-if-fresh (when the role allows it) -> fleet tenant -> post-deploy steps. Safe to re-run; this
 * is what `modules/db/scripts/db-deploy.ts` runs on every deploy. Throws when a migration
 * failed, after releasing the lock.
 */
export async function deployDatabase(
  target: DeployTarget,
  opts: DeployOptions & { seed?: boolean } = {},
): Promise<DatabaseDeployReport> {
  // Resolved first: an invalid DB_DEPLOY_SEED must fail the run before any migration is applied, not after.
  const seed = opts.seed ?? resolveSeedEnabled(process.env);
  assertSafeSchemaName(target.schema); // db.04
  return withDeployLock(target, opts, async () => {
    const report = await runMigrationSteps(target, opts);
    if (report.failed.length > 0) {
      throw new Error(report.failed.map((f) => `[db-deploy] migration ${f.name} failed: ${f.message}`).join('\n'));
    }
    await backfillTenantDatabases(target);
    if (seed) {
      await seedIfFresh(target);
    } else {
      console.log('[db-deploy] bootstrap seed disabled for this role (DB_DEPLOY_SEED).');
    }
    await seedFleetTenant(target);
    // Best effort and never throws: a step, a load or a connect failure comes back as a failed outcome, not a failed deploy.
    report.postDeploy = await postDeploy(target, ENTITIES);
    console.log('[db-deploy] done.');
    return report;
  });
}

/**
 * Destructive demo reset: drop the schema, then run the full deploy so the
 * database returns to a clean seeded demo state. Callers MUST gate this behind
 * DEMO_MODE — it permanently destroys all data.
 */
export async function resetAndRedeploy(target: DeployTarget): Promise<void> {
  await dropSchema(target);
  // The schema was just dropped, so every file is pending again, contract steps included, and no previous release can be reading what a
  // contract removes: the strict pending-contract refusal would otherwise fail every demo reset after db 007 (integration lane 1).
  await deployDatabase(target, { allowContract: true });
}
