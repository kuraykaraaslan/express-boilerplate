import 'reflect-metadata';
import { getDataSource, getSystemDataSource } from './db.datasource';
import { tenantDataSourceFor } from './db.tenant';
import { applyWriteFence } from './db.write-fence';
import { openTransaction } from './db.tx-open';

/**
 * Apply a per-statement timeout for the duration of `callback`.
 * Uses `SET LOCAL statement_timeout` so the timeout is transaction-scoped.
 * When DB_QUERY_TIMEOUT_MS is 0 (default) the call is a no-op pass-through.
 */
export async function withQueryTimeout<T>(
  tenantId: string,
  timeoutMs: number,
  callback: (qr: import('typeorm').QueryRunner) => Promise<T>,
): Promise<T> {
  const ds = await tenantDataSourceFor(tenantId);
  const qr = ds.createQueryRunner();
  await openTransaction(qr);
  try {
    if (timeoutMs > 0) {
      // set_config(), not `SET LOCAL … = $1` — see withTenantRLS below for why
      // a bind parameter there is a syntax error, not a substitution.
      // set_config()'s value argument is text, hence the explicit String().
      await qr.query("SELECT set_config('statement_timeout', $1, true)", [String(timeoutMs)]);
    }
    const result = await callback(qr);
    await qr.commitTransaction();
    return result;
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }
}

/**
 * Run `callback` inside a transaction with `SET LOCAL app.current_tenant`
 * applied so PostgreSQL RLS policies in migration 001_tenant_rls.sql are
 * enforced on the shared DataSource.  Use this for any query that touches
 * the default DataSource with tenant-scoped rows.
 *
 * Per-tenant DataSources (separate DB per tenant) already provide isolation
 * at the database level and do not need this wrapper.
 */
export async function withTenantRLS<T>(
  tenantId: string,
  callback: (qr: import('typeorm').QueryRunner) => Promise<T>,
): Promise<T> {
  const ds = await getDataSource();
  const qr = ds.createQueryRunner();
  await openTransaction(qr);
  try {
    // set_config(), not `SET LOCAL … = $1`: PostgreSQL's SET grammar does not
    // accept a bind parameter as the value — it wants a literal, so a $1
    // placeholder there is a syntax error, not a substitution. set_config() is
    // an ordinary function call and takes parameters normally; its third
    // argument (`true`) is what makes it transaction-scoped, i.e. LOCAL.
    await qr.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    await applyWriteFence(qr, tenantId);
    const result = await callback(qr);
    await qr.commitTransaction();
    return result;
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }
}

/**
 * Run `callback` with RLS bypassed for cross-tenant system operations
 * (GDPR sweeps, cron jobs, migrations). Uses SET LOCAL so bypass is
 * transaction-scoped and cannot leak to other queries.
 */
export async function withSystemRLS<T>(
  callback: (qr: import('typeorm').QueryRunner) => Promise<T>,
): Promise<T> {
  // The SYSTEM DataSource, not the default one (docs/phases/10-db Faz 0). Migration 122
  // made `app_rls_bypass()` require membership in `app_admin` as well as the
  // GUC, so once enforcement is switched on, bypass only works on the
  // connection that carries that identity. Falls back to the default
  // connection when no admin URL is configured, which is today's behaviour.
  const ds = await getSystemDataSource();
  const qr = ds.createQueryRunner();
  await openTransaction(qr);
  try {
    await qr.query("SET LOCAL app.bypass_rls = 'on'");
    const result = await callback(qr);
    await qr.commitTransaction();
    return result;
  } catch (err) {
    await qr.rollbackTransaction();
    throw err;
  } finally {
    await qr.release();
  }
}
