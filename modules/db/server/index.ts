export {
  getDataSource,
  getReadDataSource,
  getSystemDataSource,
  tenantDataSourceFor,
  clearTenantDsCache,
  withTenantRLS,
  withSystemRLS,
  withQueryTimeout,
  checkDataSourceHealth,
  ENTITIES,
} from './db';
export { TenantDatabase } from './entities/tenant_database.entity';
export { parseDbUrl, tenantQueryContext } from './db.utils';
export {
  runWithTenant,
  currentTenantId,
  requireTenantId,
  withCurrentTenantRLS,
  withTenantRepository,
  withTenantRepositoryFor,
  withTenantTransactionFor,
  withSharedTenantRepositoryFor,
  withSharedTenantTransactionFor,
  type TenantContext,
} from './db.context';
export {
  SharedDatabaseOnly, isPinnedToSharedDatabase, SharedDatabaseRoutingError,
} from './db.shared-database';
export { default as TenantDatabaseService } from './db.tenant-provision.service';
export {
  timescaleCapability, probeTimescale, type TimescaleCapability, type SqlRunner,
} from './db.timescale';
export {
  ensureTimeSeriesTables, runTimeSeriesRetention, validateTimeSeriesTables, loadTimeSeriesTables,
  type TimeSeriesTable, type ContinuousAggregateDecl,
} from './db.time-series';
export {
  runTimeSeriesRollups, readTimeSeries, pickSeriesSource, rollupColumn, markRollupDirty, rollupSource, rollupLag, summarizeRollupReports,
  type RollupLagAlert, type RollupDecl, type RollupAggregate, type RollupBucket, type RollupRunOptions, type RollupRunReport,
  type SeriesRequest, type SeriesSource,
} from './db.time-series.rollup';
