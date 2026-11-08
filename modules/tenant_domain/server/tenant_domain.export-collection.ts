import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { TenantDomain } from './entities/tenant_domain.entity';

/**
 * `tenant_export:collection` — custom domains and their verification state.
 *
 * Handed over from `tenant_export`'s hand-written list (DEP-04). The DNS
 * verification token stays in: it is a value the operator published in their own
 * zone, and rebuilding the mapping elsewhere needs it.
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const rows = await withTenantRepositoryFor(tenantId, TenantDomain, (repo) => repo.find({ where: { tenantId } }));
  return [{ key: 'domains', label: 'Custom domains', rows }];
};

export default provider;
