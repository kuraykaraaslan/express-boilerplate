// The bundle's virus-scan verdict (roadmap §6C). The scanner and its result
// live in `storage` (UploadedFile.scanStatus, storage.scan.job) — this helper
// only READS it for a stored plugin bundle; no second scanner, no mirrored status
// column (§10). Consumers: the marketplace review pre-check and consumer detail
// badge, and the operator's local plugin store (plugin_local). Lives in the Core
// runtime since OD-139 so every bundle source shares it; marketplace_developer
// re-exports it from its old path.

import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { UploadedFile } from '@kuraykaraaslan-labs/storage/server/entities/uploaded_file.entity';
import { isBuiltinBundleKey } from './builtin-bundles';

/** The two columns every stored bundle row carries (a marketplace version, a local plugin version). */
export interface StoredBundleRef {
  bundleKey: string | null;
  bundleUploadedFileId: string | null;
}

/** 'skipped' | 'pending' | 'clean' | 'infected' | 'error' — storage's vocabulary. */
export type BundleScanStatus = 'skipped' | 'pending' | 'clean' | 'infected' | 'error';

export interface BundleScanResult {
  /** null = the version ships no bundle (declarative block/widget only). */
  status: BundleScanStatus | null;
}

/**
 * The scan verdict for a version's bundle. Bundles upload under the ROOT
 * tenant, so the audit row is read there. A pre-2026-08-26 row has no
 * `bundleUploadedFileId` link — fall back to the storage key, which is unique
 * per object.
 */
export async function getBundleScanStatus(version: StoredBundleRef): Promise<BundleScanResult> {
  if (!version.bundleKey) return { status: null };
  // A built-in bundle ships with the platform and was never uploaded: there is no scan row, and none is owed.
  if (isBuiltinBundleKey(version.bundleKey)) return { status: 'skipped' };
  const row = await withTenantRepositoryFor(ROOT_TENANT_ID, UploadedFile, (repo) => version.bundleUploadedFileId
    ? repo.findOne({ where: { tenantId: ROOT_TENANT_ID, uploadedFileId: version.bundleUploadedFileId } })
    : repo.findOne({ where: { tenantId: ROOT_TENANT_ID, key: version.bundleKey! } }));
  // No audit row (legacy upload the audit write once failed on) → same honest
  // answer as an unscanned file.
  return { status: (row?.scanStatus as BundleScanStatus | undefined) ?? 'skipped' };
}
