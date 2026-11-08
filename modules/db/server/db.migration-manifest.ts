import { computeSchemaVersion } from './db.schema-version';
import {
  phasesGoBackwards,
  planAllMigrations,
  type LoadedMigration,
  type PlannedMigration,
} from './db.migration-plan';

/**
 * What a release carries on the database side: the `migrations` and
 * `schemaVersion` fields of the fleet release manifest (fleet_protocol
 * `release.manifest.schema.ts`), produced from the migration files of this
 * checkout. Pure: the files and the entity digest are passed in, so the same
 * function serves `modules/db/scripts/db-migration-manifest.ts` (CI, release workflow) and
 * the tests.
 */
export interface DatabaseReleaseManifest {
  schemaVersion: string;
  /** Every migration file in apply order. A node compares it with its own ledger to know what is pending. */
  migrations: PlannedMigration[];
  /** True when a `contract` step is present: such a release cannot claim `compatibleWithPrevious`. */
  containsContract: boolean;
}

export function buildMigrationManifest(
  files: ReadonlyArray<LoadedMigration>,
  entitiesDigest: string,
): DatabaseReleaseManifest {
  const migrations = planAllMigrations(files);
  if (phasesGoBackwards(migrations)) {
    throw new Error('[db-manifest] migrations are not in expand -> migrate -> contract order across the apply order');
  }
  return {
    schemaVersion: computeSchemaVersion({ migrations, entitiesDigest }).schemaVersion,
    migrations,
    containsContract: migrations.some((m) => m.kind === 'contract'),
  };
}
