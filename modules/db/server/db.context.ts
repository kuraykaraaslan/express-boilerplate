import 'reflect-metadata';
import type { EntityTarget, ObjectLiteral, QueryRunner, Repository } from 'typeorm';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { tenantQueryContext } from './db.utils';
import { tenantDataSourceFor } from './db.tenant';
import { getDataSource } from './db.datasource';
import { applyWriteFence } from './db.write-fence';
import { assertTenantRoutable } from './db.shared-database';
import { openTransaction } from './db.tx-open';

/**
 * The tenant-scoped data path (docs/phases/10-db Faz 2).
 *
 * ## What this is for
 *
 * Postgres RLS only bites inside a transaction that has issued
 * `SET LOCAL app.current_tenant`. Roughly 2,800 call sites in this repository
 * do `(await getDataSource()).getRepository(X)` instead — pooled, ad-hoc, no
 * transaction, so there is nowhere for that statement to live. This file is the
 * shape those call sites move to (Faz 3): one place that knows the current
 * tenant, opens the narrow transaction, sets the variable and hands back a
 * repository that is bound to it.
 *
 * Nothing in the application uses it yet. Faz 2 builds the road; Faz 3 moves
 * the traffic; Faz 4 switches enforcement on.
 *
 * ## Why there is no `getTenantRepository(X)` that just returns a repository
 *
 * The plan asked for one. It cannot exist, and the reason is worth writing
 * down: a repository that carries `SET LOCAL` must belong to the transaction
 * that ran it, and a function returning a repository has to end its transaction
 * before it returns. What the caller would get back is a handle on a released
 * query runner — a repository that either throws or, worse, quietly falls back
 * to a pooled connection with no tenant set, which is precisely the
 * silently-unscoped query this whole phase set exists to eliminate.
 *
 * So the callback shape is the API: `withTenantRepository(X, (repo) => …)`. The
 * transaction is exactly as long as the block, and it is impossible to hold a
 * repository past it.
 *
 * ## Fail-closed, always
 *
 * With no tenant in context these helpers **throw**. They never fall back to
 * "all tenants": a missing context is a bug in the caller, and the failure mode
 * of guessing is a cross-tenant read.
 *
 * ## Keep the block short
 *
 * The transaction is open for the whole callback, so a callback that also
 * uploads to S3, sends mail or calls a third-party API holds a pooled
 * connection open for the duration of that I/O. Under load that is how a
 * connection pool runs dry. Do the database work inside; do everything else
 * outside.
 */

/** What a request or job puts in scope before touching tenant data. */
export interface TenantContext {
  tenantId: string;
}

/**
 * Run `fn` with `tenantId` in async context.
 *
 * Every entry point that knows which tenant it is acting for calls this: the
 * API dispatcher for HTTP, and each background job for its own iteration.
 *
 * **Jobs must wrap each job themselves.** `AsyncLocalStorage` follows the async
 * call chain, and a worker's job callback does not inherit the context of
 * whatever scheduled it — a queue hands work to a fresh continuation, sometimes
 * minutes later and after a retry. Inheriting from the scheduler is exactly the
 * assumption that produces a job running under the wrong tenant.
 */
export function runWithTenant<T>(tenantId: string, fn: () => T): T {
  return tenantQueryContext.run({ tenantId }, fn);
}

/** The tenant in scope, or null. Prefer `requireTenantId()` before a query. */
export function currentTenantId(): string | null {
  return tenantQueryContext.getStore()?.tenantId ?? null;
}

/**
 * The tenant in scope, or an error.
 *
 * Deliberately an `AppError` with a 500: reaching tenant data with no tenant is
 * not a bad request from a user, it is a code path that forgot to say who it
 * was acting for.
 */
export function requireTenantId(): string {
  const tenantId = currentTenantId();
  if (!tenantId) {
    throw new AppError(
      'No tenant in context — tenant-scoped data was reached outside runWithTenant()',
      500,
      ErrorCode.INTERNAL_ERROR,
    );
  }
  return tenantId;
}

/**
 * Run `callback` in a transaction scoped to the tenant in context.
 *
 * The convenience layer over `withTenantRLS(tenantId, …)` — same narrow
 * transaction, same `SET LOCAL`, one less thing for a caller to pass (and
 * therefore one less thing for a caller to pass *wrongly*).
 */
export async function withCurrentTenantRLS<T>(
  callback: (qr: QueryRunner) => Promise<T>,
): Promise<T> {
  return withTenantScope(requireTenantId(), callback);
}

/**
 * The everyday shape: one entity, one short block of database work.
 *
 * ```ts
 * const rows = await withTenantRepository(Badge, (repo) => repo.find({ where: { isActive: true } }));
 * ```
 *
 * The repository lives inside the transaction that set the tenant, so a
 * forgotten `where: { tenantId }` stops being a cross-tenant leak and becomes
 * an empty result — which is the entire point of the RLS layer.
 */
export async function withTenantRepository<Entity extends ObjectLiteral, T>(
  entity: EntityTarget<Entity>,
  callback: (repo: Repository<Entity>) => Promise<T>,
): Promise<T> {
  // An entity pinned to the shared database never takes the per-tenant route (db.shared-database.ts).
  assertTenantRoutable(entity);
  return withCurrentTenantRLS((qr) => callback(qr.manager.getRepository(entity)));
}

/**
 * The same, for an explicit tenant — background work that iterates tenants and
 * has the id in hand rather than in context.
 */
export async function withTenantRepositoryFor<Entity extends ObjectLiteral, T>(
  tenantId: string,
  entity: EntityTarget<Entity>,
  callback: (repo: Repository<Entity>) => Promise<T>,
): Promise<T> {
  assertTenantRoutable(entity);
  return withTenantScope(tenantId, (qr) => callback(qr.manager.getRepository(entity)));
}

/**
 * A tenant-scoped transaction for work that spans MORE than one entity — the
 * shape `withTenantRepositoryFor` cannot express, because its callback is
 * handed a single entity's repository.
 *
 * ```ts
 * await withTenantTransactionFor(tenantId, async (qr) => {
 *   await qr.manager.getRepository(Touch).update(…)
 *   await qr.manager.getRepository(Source).softRemove(…)
 * })
 * ```
 *
 * Same narrow transaction and the same transaction-local tenant as the other
 * helpers, on the tenant's own DataSource (unlike `withTenantRLS`, which
 * always uses the shared one and would read the wrong database for a tenant
 * with a dedicated `tenant_databases` row). Use `qr.manager` for every
 * repository inside it — `check:tenant-repo-coverage` counts exactly that
 * receiver as scoped. Keep the block short: it holds a pooled connection.
 */
export async function withTenantTransactionFor<T>(
  tenantId: string,
  callback: (qr: QueryRunner) => Promise<T>,
): Promise<T> {
  return withTenantScope(tenantId, callback);
}

/**
 * `withTenantRepositoryFor` for an entity pinned to the shared database (`@SharedDatabaseOnly`, db.shared-database.ts):
 * the same narrow transaction, transaction-local tenant, write fence and async context, but ALWAYS on the shared
 * DataSource, whether or not the tenant has a database of its own. `api_keys` is the case: `verify()` finds a key by
 * its hash before any tenant is known, so the row must be where that lookup reads (docs/phases/02-fleet F8).
 */
export async function withSharedTenantRepositoryFor<Entity extends ObjectLiteral, T>(
  tenantId: string,
  entity: EntityTarget<Entity>,
  callback: (repo: Repository<Entity>) => Promise<T>,
): Promise<T> {
  return withTenantScope(tenantId, (qr) => callback(qr.manager.getRepository(entity)), getDataSource);
}

/**
 * `withTenantTransactionFor` on the shared DataSource, for work on entities pinned there (see
 * `withSharedTenantRepositoryFor`). Every entity in the block must live on the shared database: a tenant-routed entity
 * read here would come from the shared database even for a tenant with its own, which is the opposite mistake.
 */
export async function withSharedTenantTransactionFor<T>(
  tenantId: string,
  callback: (qr: QueryRunner) => Promise<T>,
): Promise<T> {
  return withTenantScope(tenantId, callback, getDataSource);
}

/**
 * One tenant-scoped transaction on the DataSource that tenant actually uses.
 *
 * Not `getDataSource()`: a tenant with a row in `tenant_databases` lives in its
 * own database, and running its query against the shared connection would read
 * the wrong database entirely — a much older bug than the one RLS is for. On a
 * dedicated database the `SET LOCAL` is harmless (isolation is already physical
 * there); on the shared one it is what makes the policies apply.
 */
async function withTenantScope<T>(
  tenantId: string,
  callback: (qr: QueryRunner) => Promise<T>,
  // The shared-pinned helpers pass getDataSource; everything else routes by tenant.
  dataSource: (tenantId: string) => Promise<import('typeorm').DataSource> = tenantDataSourceFor,
): Promise<T> {
  const ds = await dataSource(tenantId);
  const qr = ds.createQueryRunner();
  await openTransaction(qr);
  try {
    // SET LOCAL, never SET: a session-level variable outlives the transaction
    // on a pooled connection and would hand the next tenant the previous
    // tenant's id (docs/phases/10-db locked decision).
    //
    // set_config(), not `SET LOCAL … = $1`: PostgreSQL's SET grammar does not
    // accept a bind parameter as the value — it wants a literal, so a $1
    // placeholder there is a syntax error, not a substitution. set_config() is
    // an ordinary function call and takes parameters normally; its third
    // argument (`true`) is what makes it transaction-scoped, i.e. LOCAL.
    await qr.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    // A tenant being moved (MIGRATING on the source, IMPORTING on the target), or an old home the directory fenced (decision F1), is read-only for the whole app: db.write-fence.ts.
    await applyWriteFence(qr, tenantId);
    // Also put the tenant in async context for the block, so the shadow counter
    // and the slow-query tag see a query that is already tenant-scoped by the
    // transaction above. Background jobs reach here with an explicit tenantId
    // and no ALS context; without this every such query was counted as a
    // "no tenant in context" query that would go dark after the cutover.
    const result = await runWithTenant(tenantId, () => callback(qr));
    await qr.commitTransaction();
    return result;
  } catch (error) {
    await qr.rollbackTransaction();
    throw error;
  } finally {
    await qr.release();
  }
}
