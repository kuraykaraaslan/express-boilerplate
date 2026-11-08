import { DataSource, type EntityManager, type EntitySchema } from 'typeorm';
import { resolveDbSslFromEnv } from './db.utils';
import { WHERE_VALUE_BEHAVIOR } from './db.where-values';

/**
 * Post-deploy steps: idempotent data upkeep that belongs to another module and has to run on EVERY deploy of the
 * control database, such as dashboard publishing the platform's builtin widgets into the root tenant.
 *
 * A module contributes a step to the `db:post_deploy` point; `deployDatabase` runs every installed step after the
 * schema, the SQL migrations, the bootstrap seed and the fleet tenant, still under the deploy advisory lock, so two
 * deploys never run one step at the same time. `db` never imports the owner (the `db:time_series` inversion).
 *
 * The rules a step is written against:
 *  - Idempotent: a deploy reruns it with nothing to do, and running it twice writes nothing the second time.
 *  - Self-contained: it reaches the database ONLY through the context (a DataSource on the deploy target, over the
 *    direct connection), never through the runtime DataSource, Redis or the env module, because the deploy runs at
 *    build time and in a migrate sidecar where those may not exist and an open client keeps the process alive.
 *  - Best effort: a step that throws is logged and reported, the other steps still run, and the deploy does not
 *    fail (the next deploy retries). The same holds for the phase itself: steps that cannot be loaded at all or a
 *    target that cannot be connected are a failed outcome, never a failed deploy. The owning module keeps a manual
 *    script for an operator who cannot wait.
 */

export const POST_DEPLOY_POINT = 'db:post_deploy';

export interface PostDeployContext {
  /** An initialised DataSource on the deploy target with the application's entities; never synchronizes. */
  dataSource: DataSource;
  /** One transaction scoped to `tenantId` (`app.current_tenant`, transaction-local), so tenant RLS policies apply. */
  withTenantTransaction<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T>;
  /** A progress line, prefixed with the step's contribution id. */
  log(message: string): void;
}

/** The default export of a `db:post_deploy` contribution. Returns an optional one-line summary for the deploy log. */
export interface PostDeployStep {
  run(ctx: PostDeployContext): Promise<string | void>;
}

export interface PostDeployOutcome {
  /** The contribution id (`<module>:db:post_deploy:<key>`). */
  id: string;
  ok: boolean;
  /** The step's summary when it succeeded, the error message when it did not. */
  message?: string;
}

/** A transaction on `ds` with `app.current_tenant` set for it only (set_config(..., true): LOCAL, never session-wide). */
export async function withTenantTransactionOn<T>(
  ds: DataSource,
  tenantId: string,
  fn: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  return ds.transaction(async (manager) => {
    await manager.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    return fn(manager);
  });
}

/**
 * Discover every contribution to `db:post_deploy` through the host runtime. The steps are the deployment's, not a
 * tenant's, so every installed contribution counts whatever its module's state for a tenant (a system context).
 */
/**
 * A contribution that declares `metadata.tenantDatabases: true` is also run by the deploy fan-out against every dedicated tenant
 * database, after that database's migrations (P9-6: data that a tenant with a database of its own keeps there, such as webhook
 * secrets to encrypt). Such a step must not assume control-database tables beyond its own.
 */
export const TENANT_DATABASES_METADATA = 'tenantDatabases';

/** Whether a contribution opted into the tenant databases of the fan-out. */
export function runsOnTenantDatabases(contribution: { metadata?: Record<string, unknown> | null }): boolean {
  return contribution.metadata?.[TENANT_DATABASES_METADATA] === true;
}

export async function loadPostDeploySteps(opts: { tenantDatabase?: boolean } = {}): Promise<{
  steps: Array<{ id: string; step: PostDeployStep }>;
  failed: PostDeployOutcome[];
}> {
  const { ext, systemCtx } = await import('@kuraykaraaslan-labs/common/server/extensions/ext');
  const { dbPostDeployLoaders } = await import('@kuraykaraaslan-labs/common/server/generated/extensions/db.post_deploy');
  const { loaded, failed } = await ext.loadAll<PostDeployStep>(
    POST_DEPLOY_POINT, systemCtx('post-deploy steps: deployment upkeep, every tenant'), dbPostDeployLoaders,
  );
  const steps: Array<{ id: string; step: PostDeployStep }> = [];
  const failures: PostDeployOutcome[] = failed.map((f) => ({ id: f.contributionId, ok: false, message: `${f.reason}: ${f.message}` }));
  for (const { contribution, impl } of loaded) {
    // On a tenant database only the steps that opted in run (a step that cannot load is still reported: it would fail there too).
    if (opts.tenantDatabase && !runsOnTenantDatabases(contribution)) continue;
    if (typeof impl?.run !== 'function') {
      failures.push({ id: contribution.id, ok: false, message: 'the default export has no run(ctx) function' });
      continue;
    }
    steps.push({ id: contribution.id, step: impl });
  }
  return { steps, failed: failures };
}

/** Run `steps` in order against `ds`, each in its own try. Never throws for a failing step. */
export async function runPostDeploySteps(
  ds: DataSource,
  steps: Array<{ id: string; step: PostDeployStep }>,
): Promise<PostDeployOutcome[]> {
  const outcomes: PostDeployOutcome[] = [];
  for (const { id, step } of steps) {
    const ctx: PostDeployContext = {
      dataSource: ds,
      withTenantTransaction: (tenantId, fn) => withTenantTransactionOn(ds, tenantId, fn),
      log: (message) => console.log(`[db-deploy] ${id}: ${message}`),
    };
    try {
      const summary = await step.run(ctx);
      outcomes.push({ id, ok: true, ...(summary ? { message: summary } : {}) });
      console.log(`[db-deploy] post-deploy ${id}: ${summary || 'done'}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ id, ok: false, message });
      console.warn(`[db-deploy] post-deploy ${id} failed (the next deploy retries): ${message}`);
    }
  }
  return outcomes;
}

/** The pseudo contribution id a failure of the phase itself (not of one step) is reported under. */
export const POST_DEPLOY_PHASE_ID = 'db:post_deploy';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * The deploy's post-deploy phase on `target`: load the contributed steps and run them. No contribution opens no
 * connection. A step that cannot load is reported like a step that failed.
 *
 * Never throws: it runs after the migrations succeeded, and the phase is best effort. A failure to load the steps at
 * all (the host runtime or the generated loader map cannot be imported) or to connect to the target is logged loudly
 * and returned as one failed outcome under {@link POST_DEPLOY_PHASE_ID}; the next deploy retries. A DataSource that
 * initialised is always destroyed, so an open pool never keeps the deploy process alive.
 */
export async function postDeploy(
  target: { url: string; schema?: string },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM's own entity list type
  entities: ReadonlyArray<Function | EntitySchema>,
  /** `tenantDatabase`: `target` is a dedicated tenant database of the fan-out; only the steps that opted in run. */
  opts: { tenantDatabase?: boolean } = {},
): Promise<PostDeployOutcome[]> {
  let loaded: Awaited<ReturnType<typeof loadPostDeploySteps>>;
  try {
    loaded = await loadPostDeploySteps(opts);
  } catch (err) {
    const message = `the post-deploy steps could not be loaded: ${errorMessage(err)}`;
    console.error(`[db-deploy] POST-DEPLOY FAILED (no step ran, the next deploy retries): ${message}`);
    return [{ id: POST_DEPLOY_PHASE_ID, ok: false, message }];
  }
  const { steps, failed } = loaded;
  for (const f of failed) console.warn(`[db-deploy] post-deploy ${f.id} could not be loaded: ${f.message}`);
  if (steps.length === 0) return failed;
  let ds: DataSource;
  try {
    ds = await openPostDeployDataSource(target, entities);
  } catch (err) {
    const message = `could not connect to the deploy target: ${errorMessage(err)}`;
    console.error(`[db-deploy] POST-DEPLOY FAILED (${steps.length} step(s) not run, the next deploy retries): ${message}`);
    return [...failed, { id: POST_DEPLOY_PHASE_ID, ok: false, message }];
  }
  try {
    return [...failed, ...await runPostDeploySteps(ds, steps)];
  } finally {
    await destroyQuietly(ds);
  }
}

/**
 * The libpq `options` startup parameter that pins `search_path` to `schema` alone on every connection of a pool: `-c search_path=<ident>`,
 * the identifier double-quoted (embedded quotes doubled) and then backslash-escaped for the options parser (backslashes and whitespace).
 */
export function searchPathStartupOption(schema: string): string {
  if (!schema || /[\u0000-\u001f\u007f]/.test(schema)) throw new Error('the deploy target schema is not a valid identifier');
  const ident = `"${schema.replace(/"/g, '""')}"`;
  return `-c search_path=${ident.replace(/[\\\s]/g, (ch) => `\\${ch}`)}`;
}

/**
 * An initialised DataSource on the deploy target for the post-deploy steps. With a `schema` (a database stored in its own PostgreSQL
 * schema, `?schema=` of the URL), TypeORM's `schema` option only qualifies the entity metadata; raw SQL with bare table names and
 * `current_schema()` (the encrypted-columns backfill) resolves on the connection's `search_path`. So the search_path is pinned to that schema
 * alone as a startup parameter of EVERY connection the pool opens (not a SET on one connection, which a pooled transaction may not get),
 * and verified after connecting: a connection whose current_schema() is not the target's (a URL `options=` that overrides it, a missing
 * schema) fails the phase instead of letting a step read or write another schema's rows. `public` is deliberately not on the path, so a
 * table missing from the schema is never resolved to the control database's copy. Exported for the integration test.
 */
export async function openPostDeployDataSource(
  target: { url: string; schema?: string },
  // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- TypeORM's own entity list type
  entities: ReadonlyArray<Function | EntitySchema>,
): Promise<DataSource> {
  const ds = new DataSource({
    type: 'postgres',
    url: resolveDbSslFromEnv(target.url).url,
    ssl: resolveDbSslFromEnv(target.url).ssl,
    schema: target.schema,
    entities: [...entities],
    synchronize: false,
    logging: ['error'],
    invalidWhereValuesBehavior: WHERE_VALUE_BEHAVIOR,
    ...(target.schema ? { extra: { options: searchPathStartupOption(target.schema) } } : {}),
  });
  try {
    await ds.initialize();
    if (target.schema) {
      const rows = await ds.query('SELECT current_schema() AS schema') as Array<{ schema: string | null }>;
      const actual = rows[0]?.schema ?? null;
      if (actual !== target.schema) {
        throw new Error(`the connection's search_path does not resolve to the target schema "${target.schema}" (current_schema() is ${actual === null ? 'NULL: the schema does not exist' : `"${actual}"`})`);
      }
    }
  } catch (err) {
    // Also a driver that connected before a later initialise step threw: an open pool must not keep the process alive.
    if (ds.isInitialized) await destroyQuietly(ds);
    throw err;
  }
  return ds;
}

/** Destroy an initialised `ds`; a failing destroy is logged, never thrown (the outcomes are already decided). */
async function destroyQuietly(ds: DataSource): Promise<void> {
  try {
    await ds.destroy();
  } catch (err) {
    console.warn(`[db-deploy] post-deploy: closing the connection failed: ${errorMessage(err)}`);
  }
}
