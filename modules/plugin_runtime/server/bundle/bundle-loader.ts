// Load a plugin bundle's source from storage and prove it is the bundle that was reviewed.
// Core since OD-139: the marketplace and the operator's local plugin store (plugin_local) both load
// through it; marketplace/server/bundle-loader re-exports it from its old path.

import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { assertBundleMatches } from './bundle-integrity';
import { builtinBundleCode, isBuiltinBundleKey } from './builtin-bundles';

/**
 * The bundle's code. Throws if it cannot be read, or no longer hashes to the checksum recorded at upload. A `builtin:` key is a
 * bundle that ships with the platform (builtin-bundles.ts), read from code, never from storage; it is hash-checked the same way.
 */
export async function loadBundleCode(bundleKey: string, recordedSha256?: string | null): Promise<string> {
  if (isBuiltinBundleKey(bundleKey)) {
    const code = builtinBundleCode(bundleKey);
    if (code === null) throw new Error('failed to load plugin bundle: no such built-in bundle');
    assertBundleMatches(recordedSha256, code);
    return code;
  }
  const url = await StorageService.getServerReadUrl(ROOT_TENANT_ID, bundleKey, 120);
  let code: string;
  // Local filesystem storage returns a file:// URL (Node fetch can't read those).
  if (url.startsWith('file://')) {
    const [{ readFile }, { fileURLToPath }] = await Promise.all([import('node:fs/promises'), import('node:url')]);
    code = await readFile(fileURLToPath(url), 'utf8');
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to load plugin bundle (${res.status})`);
    code = await res.text();
  }
  assertBundleMatches(recordedSha256, code);
  return code;
}
