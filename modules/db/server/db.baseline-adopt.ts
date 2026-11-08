import 'reflect-metadata';
import { Client } from 'pg';
import { ENTITIES } from '@kuraykaraaslan-labs/db';
import { BASELINE_NAME } from './db.baseline';
import {
  describeDatabase,
  ensureMigrationLedger,
  recordMigrationApplied,
  synchronizeSchema,
  withDeployLock,
  type DeployOptions,
  type DeployTarget,
} from './db.deploy';
import { loadModuleMigrations } from './db.migration-files';
import { quoteSchema } from './db.schema-ident';
import { migrationChecksum } from './db.migration-plan';
import { classifySyncStatements } from './db.schema-drift';
import { logEntitySync } from './db.schema-scratch';

/**
 * Adoption: bring an EXISTING database under the baseline. A database that already has tables (built by `synchronize`
 * before this repo had a baseline, or migrated over an older schema) must never run `db:000_baseline.sql` (it would try
 * to create what exists), yet it needs the ledger row so later migrations can follow.
 *
 * So adoption does the one last sync pass, then records the baseline in the ledger without executing it:
 *
 *   1. under the database's deploy lock, the baseline row already in the ledger means there is nothing to do (the stored
 *      checksum must equal the file: a baseline that changed after it was recorded is a defect and throws);
 *   2. the statements `synchronize` is about to run are listed first (nothing executed). Removing what the entities do
 *      not declare is how a sync pass loses an index or constraint that a SQL migration added, so a plan that contains
 *      any removal is refused unless the operator passes `allowDrops` after reading it;
 *   3. `synchronize` runs, then the ledger row is written.
 *
 * Safe to re-run. `modules/db/scripts/db-baseline.ts --adopt` is the command line; a `synchronize`-mode deploy does the same thing
 * implicitly (db.deploy.ts) because its sync pass IS the last sync pass.
 */

export interface AdoptBaselineOptions extends DeployOptions {
  /** Allow the sync pass to remove tables, columns, indexes or constraints the entities do not declare. */
  allowDrops?: boolean;
}

export interface AdoptBaselineResult {
  database: string;
  outcome: 'adopted' | 'already-recorded';
  /** Statements the sync pass ran (0 when the schema already matched the entities). */
  synchronizedStatements: number;
}

export async function adoptBaseline(target: DeployTarget, opts: AdoptBaselineOptions = {}): Promise<AdoptBaselineResult> {
  const file = loadModuleMigrations().find((f) => f.name === BASELINE_NAME);
  if (!file) throw new Error(`[db-baseline] ${BASELINE_NAME} does not exist in this checkout: generate it first (npm run db:baseline)`);
  const checksum = migrationChecksum(file.sql);
  const database = describeDatabase(target);

  return withDeployLock(target, opts, async () => {
    const client = new Client({ connectionString: target.url });
    await client.connect();
    try {
      if (target.schema) {
        await client.query(`CREATE SCHEMA IF NOT EXISTS ${quoteSchema(target.schema)}`);
        await client.query(`SET search_path TO ${quoteSchema(target.schema)}`);
      }
      await ensureMigrationLedger(client);
      const { rows } = await client.query<{ checksum: string | null }>(
        'SELECT checksum FROM _sql_migrations WHERE name = $1',
        [BASELINE_NAME],
      );
      if (rows.length > 0) {
        if (rows[0]!.checksum !== null && rows[0]!.checksum !== checksum) {
          throw new Error(`[db-baseline] ${database}: the recorded checksum of ${BASELINE_NAME} differs from the file in this checkout`);
        }
        return { database, outcome: 'already-recorded' as const, synchronizedStatements: 0 };
      }

      const plan = await logEntitySync(target, ENTITIES);
      const drift = classifySyncStatements(plan);
      if (drift.extra.length > 0 && opts.allowDrops !== true) {
        throw new Error(
          `[db-baseline] ${database}: the sync pass would remove ${drift.extra.length} object(s) the entities do not declare, `
          + `which may have been added by SQL migrations (first: ${drift.extra.slice(0, 5).map((e) => e.summary).join('; ')}). `
          + 'Review them, then pass --allow-drops to run the sync pass anyway.',
        );
      }
      if (plan.length > 0) await synchronizeSchema(target);
      await recordMigrationApplied(client, file, checksum);
      console.log(`[db-baseline] ${database}: recorded ${BASELINE_NAME} (${plan.length} sync statement(s) run first).`);
      return { database, outcome: 'adopted' as const, synchronizedStatements: plan.length };
    } finally {
      await client.end().catch(() => undefined);
    }
  });
}
