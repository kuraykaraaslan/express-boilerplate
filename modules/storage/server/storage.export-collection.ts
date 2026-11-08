import 'reflect-metadata';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { UploadedFile } from './entities/uploaded_file.entity';

const ROW_CAP = 5000;

/**
 * `tenant_export:collection` — the tenant's uploaded-file index.
 *
 * Handed over from `tenant_export`'s hand-written list (DEP-04). This is the
 * INDEX, not the bytes: keys, names, sizes, owners and timestamps. The objects
 * themselves live in the bucket and are not inlined into a JSON document.
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const rows = await withTenantRepositoryFor(tenantId, UploadedFile, (repo) => repo.find({
    where: { tenantId }, order: { createdAt: 'DESC' }, take: ROW_CAP,
  }));
  return [{ key: 'uploadedFiles', label: 'Uploaded files', rows }];
};

export default provider;
