// Plugins whose bundle ships with the platform instead of living in storage. Their version rows (plugin_local, or a seeded
// marketplace listing) carry the bundle key `builtin:<scopedName>`, and `loadBundleCode` answers the code from here. The
// recorded checksum is still compared on every load, so a row cannot name a built-in and run something else, and a platform
// update that changes the bundle needs a new version row (the old one stops loading).
//
// Why: the local disk storage plugin (`@local/storage`) is what gives a fresh or on-premise platform its storage, and every
// other plugin bundle is stored through storage. Its own bundle cannot be, or the plugin could never be installed.

import { createHash } from 'node:crypto';
import { BUILTIN_PLUGIN_SOURCES } from './builtin-bundles.generated';

export const BUILTIN_BUNDLE_PREFIX = 'builtin:';

export interface BuiltinPlugin {
  scopedName: string;
  manifestJson: string;
  code: string;
  bundleSha256: string;
  bundleKey: string;
}

/** The bundle key a built-in plugin's version rows carry. */
export const builtinBundleKey = (scopedName: string): string => `${BUILTIN_BUNDLE_PREFIX}${scopedName}`;

/** Whether a version row's bundle key names a built-in bundle (never a storage object). */
export const isBuiltinBundleKey = (bundleKey: string | null | undefined): boolean =>
  typeof bundleKey === 'string' && bundleKey.startsWith(BUILTIN_BUNDLE_PREFIX);

/** The built-in plugin of that scoped name, or null. */
export function builtinPlugin(scopedName: string): BuiltinPlugin | null {
  const src = Object.hasOwn(BUILTIN_PLUGIN_SOURCES, scopedName) ? BUILTIN_PLUGIN_SOURCES[scopedName] : undefined;
  if (!src) return null;
  return {
    scopedName,
    manifestJson: src.manifestJson,
    code: src.code,
    bundleSha256: createHash('sha256').update(src.code, 'utf8').digest('hex'),
    bundleKey: builtinBundleKey(scopedName),
  };
}

/** The code behind a `builtin:` bundle key, or null when the key names no built-in. */
export function builtinBundleCode(bundleKey: string): string | null {
  if (!isBuiltinBundleKey(bundleKey)) return null;
  return builtinPlugin(bundleKey.slice(BUILTIN_BUNDLE_PREFIX.length))?.code ?? null;
}

/** Scoped names of every built-in plugin. */
export const BUILTIN_PLUGIN_NAMES: readonly string[] = Object.keys(BUILTIN_PLUGIN_SOURCES);
