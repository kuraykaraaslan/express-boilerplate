import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { TenantUsageMetricRow } from './entities/tenant_usage_metric.entity';

/**
 * `tenant_export:collection` — the tenant's usage counters: one row per period and declared metric from the open table
 * (42-telemetry/06 step 5; the wide monthly table is no longer written).
 *
 * Handed over from `tenant_export`'s hand-written list (DEP-04). Uncapped: this
 * is one row per period and metric, not an event stream.
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const rows = await withTenantRepositoryFor(tenantId, TenantUsageMetricRow, (repo) => repo.find({ where: { tenantId }, order: { period: 'DESC', metric: 'ASC' } }));
  return [{ key: 'tenantUsage', label: 'Usage counters', rows }];
};

export default provider;
