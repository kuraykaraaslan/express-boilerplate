import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { TenantMember } from './entities/tenant_member.entity';

/**
 * `tenant_export:collection` — who belongs to this tenant, and as what.
 *
 * Handed over from `tenant_export`'s hand-written list (DEP-04). Membership rows
 * carry no credentials — passwords live on `user_security` in the system DB, and
 * the built-in collector's `safeMembers` mapping was a no-op spread that said so
 * in a comment. Stating it here, where the columns are, is the point of the
 * handover.
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const rows = await withTenantRepositoryFor(tenantId, TenantMember, (repo) => repo.find({ where: { tenantId } }));
  return [{ key: 'members', label: 'Tenant members', rows }];
};

export default provider;
