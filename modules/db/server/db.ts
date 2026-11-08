// Database layer entry point. The implementation is split across focused
// modules — this file re-exports the stable public surface its many callers
// (`@/modules/db`) depend on:
//   • db.entities      — the ENTITIES registry (single source for every @Entity)
//   • db.datasource    — default / read-replica / system DataSources + health
//   • db.tenant        — per-tenant DataSource cache + resolution
//   • db.rls           — transaction wrappers (query timeout, tenant/system RLS)
//   • db.shadow        — the rollout's watcher: tenant-scoped queries with no
//                        tenant in context, counted while the policies are still
//                        dormant (Faz 3 §3.2)
export { ENTITIES } from './db.entities';
export {
  buildDataSourceOptions,
  getDataSource,
  getReadDataSource,
  getSystemDataSource,
  checkDataSourceHealth,
} from './db.datasource';
export { tenantDataSourceFor, clearTenantDsCache } from './db.tenant';
export { withQueryTimeout, withTenantRLS, withSystemRLS } from './db.rls';
// The tenant-scoped data path (docs/phases/10-db Faz 2). Nothing uses it yet — Faz 3
// moves the ~2,800 `getRepository()` call sites onto it.
export {
  observeQuery,
  shadowStats,
  resetShadowStats,
  registerTenantScopedTables,
} from './db.shadow';
export {
  runWithTenant,
  currentTenantId,
  requireTenantId,
  withCurrentTenantRLS,
  withTenantRepository,
  withTenantRepositoryFor,
  withSharedTenantRepositoryFor,
  withSharedTenantTransactionFor,
  type TenantContext,
} from './db.context';
