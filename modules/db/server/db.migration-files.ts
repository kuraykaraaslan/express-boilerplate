import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BASELINE_NAME } from './db.baseline';
import { planMigration, type LoadedMigration } from './db.migration-plan';

/**
 * Discovery of the per-module SQL migrations: `modules/<id>/server/migrations/*.sql`,
 * modules ordered by their `module.json` `dependencies.requires` (a cycle throws),
 * files sorted by name inside a module. Identity is `<module>:<file>`, so each
 * module numbers its own files. Shared by the deploy runner, the schema version and
 * the release manifest generator.
 */

const MODULES_DIR = join(process.cwd(), 'modules');

function orderedModuleIds(): string[] {
  if (!existsSync(MODULES_DIR)) return [];

  const moduleIds = readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  const manifests = new Map<string, { requires: string[] }>();

  for (const moduleId of moduleIds) {
    const manifestPath = join(MODULES_DIR, moduleId, 'module.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies?: { requires?: string[] };
    };
    manifests.set(moduleId, { requires: manifest.dependencies?.requires ?? [] });
  }

  const ordered: string[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (moduleId: string): void => {
    if (visited.has(moduleId)) return;
    if (visiting.has(moduleId)) {
      throw new Error(`[db-deploy] circular module dependency at "${moduleId}"`);
    }
    visiting.add(moduleId);
    for (const dependency of manifests.get(moduleId)?.requires ?? []) {
      if (manifests.has(dependency)) visit(dependency);
    }
    visiting.delete(moduleId);
    visited.add(moduleId);
    ordered.push(moduleId);
  };
  for (const moduleId of moduleIds.sort()) visit(moduleId);
  return ordered;
}

/**
 * Every migration file with its SQL, in apply order.
 *
 * One file is special: the baseline (`db:000_baseline.sql`, db.baseline.ts) builds the whole entity schema, so every
 * other file runs after it whatever its module's position. Otherwise no module is special: `db` owns the runner, not
 * migration files. The tenant-isolation SQL (RLS functions, roles, generated policies — docs/phases/10-db) lives in
 * `tenant`, so a module whose SQL uses `app_current_tenant()` must list `tenant` in `dependencies.requires`.
 */
export function loadModuleMigrations(): LoadedMigration[] {
  const files = readModuleMigrations();
  const rest = files.filter((f) => f.name !== BASELINE_NAME);
  // db.02: a `contract` step (destructive; run in the READ_ONLY window, after every expand of its release) is applied
  // after every non-contract file, whatever its module's position: modules are ordered by dependency, not by phase, so
  // a contract in a low module (`db`) sat before the expand files of every module that requires it and the plan read
  // as "backwards". The relative order inside each group is unchanged.
  const isContract = (f: LoadedMigration): boolean => planMigration(f).kind === 'contract';
  return [...files.filter((f) => f.name === BASELINE_NAME), ...rest.filter((f) => !isContract(f)), ...rest.filter(isContract)];
}

function readModuleMigrations(): LoadedMigration[] {
  return orderedModuleIds().flatMap((moduleId) => {
    const directory = join(MODULES_DIR, moduleId, 'server/migrations');
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((file) => file.endsWith('.sql'))
      .sort()
      .map((file) => ({
        moduleId,
        file,
        name: `${moduleId}:${file}`,
        sql: readFileSync(join(directory, file), 'utf8'),
      }));
  });
}
