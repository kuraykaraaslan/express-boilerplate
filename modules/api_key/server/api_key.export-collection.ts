import 'reflect-metadata';
import { withSharedTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import type {
  ExportCollection,
  ExportCollectionProvider,
} from '@kuraykaraaslan-labs/common/server/common.export-contracts';
import { ApiKey } from './entities/api_key.entity';

/**
 * `tenant_export:collection` — this tenant's API keys, as metadata only.
 *
 * Handed over from `tenant_export`'s hand-written list (DEP-04): the module that
 * knows `keyHash` is the secret is this one. Previously the exporter imported
 * the entity and remembered to strip the field itself — which works right up to
 * the day this module adds a second secret column and nobody tells it.
 *
 * `keyHash` never leaves: it is the verifier for a credential that is still
 * live, and an export is a file that gets emailed around. The operator can
 * always rotate; they can never un-send.
 */
const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const rows = await withSharedTenantRepositoryFor(tenantId, ApiKey, (repo) => repo.find({ where: { tenantId } }));
  const safe = rows.map(({ keyHash: _keyHash, ...rest }) => rest);
  return [{ key: 'apiKeys', label: 'API keys', rows: safe }];
};

export default provider;
