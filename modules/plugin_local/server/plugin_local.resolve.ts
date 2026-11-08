// Per-dispatch resolver for operator-installed local plugins: given a tenant and a LocalPlugin id, the SandboxConfig and
// a bundle loader, or null when it must not run. Mirrors marketplace/server/plugin-resolve.ts without the marketplace
// gates (publisher, listing, purchase). Every gate below is judged on every dispatch:
//   installed + active for the tenant (plugin.local.<pluginId>.{version,active}, the ledger's projection)
//   the plugin is not disabled platform-wide, the version is approved and not yanked
//   while signatures are required, the version still verifies against a trusted key
//   the bundle's virus scan has not come back `infected` (storage scans asynchronously by default, so a verdict can
//   arrive after approval; it is read here, cached 60 s per version like the marketplace's test-build gate)
// The capabilities come ONLY from the approved grant (sandboxJson), never from the manifest, and the limits are capped
// at the platform maximum again here; a change of `pluginLocalMaxLimits` also evicts the warm isolates (the host fixes
// an isolate's memory ceiling when it first loads a version), so the next call runs under the new ceiling.

import { getDataSource } from '@kuraykaraaslan-labs/db';
import redis from '@kuraykaraaslan-labs/redis';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import type { SandboxConfig } from '@kuraykaraaslan-labs/plugin_runtime/server/rpc/protocol';
import { localInstallKeys, localRuntimePluginId } from '@kuraykaraaslan-labs/plugin_runtime/server/broker/install-keys';
import { loadBundleCode } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/bundle-loader';
import { getBundleScanStatus } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/bundle-scan';
import { egressHostsFromSettings } from '@kuraykaraaslan-labs/plugin_runtime/server/config/plugin-config.service';
import { capLimits, type ManifestFieldDecl } from '@kuraykaraaslan-labs/plugin_runtime/server/manifest/plugin-manifest';
import { LocalPlugin } from './entities/local_plugin.entity';
import { LocalPluginVersion } from './entities/local_plugin_version.entity';
import { readTrustPolicy, stillTrusted } from './plugin_local.trust';
import { parseGrant } from './plugin_local.store.service';
import { UUID_RE } from './plugin_local.types';

export interface RunnableLocalPlugin {
  plugin: LocalPlugin;
  version: LocalPluginVersion;
  sandbox: SandboxConfig;
  getBundle: () => Promise<string>;
}

/**
 * True when storage's scanner has called the bundle infected. Cached 60 s per version (a lookup per dispatch would be a
 * database read on every provider call); a lookup failure is not a verdict and lets the other gates decide.
 */
async function bundleInfected(version: LocalPluginVersion): Promise<boolean> {
  const cacheKey = `plugin_local:scan:${version.versionId}`;
  const cached = await redis.get(cacheKey).catch(() => null);
  if (cached === '1') return true;
  if (cached === '0') return false;
  const infected = (await getBundleScanStatus(version).catch(() => ({ status: null }))).status === 'infected';
  await redis.setex(cacheKey, 60, infected ? '1' : '0').catch(() => {});
  return infected;
}

export async function resolveLocalPlugin(tenantId: string, pluginId: string): Promise<RunnableLocalPlugin | null> {
  if (!UUID_RE.test(pluginId)) return null;                            // ids are uuids: anything else is not ours
  const rec = await SettingService.getByKeys(tenantId, [localInstallKeys.version(pluginId), localInstallKeys.active(pluginId)]);
  const versionId = rec[localInstallKeys.version(pluginId)];
  if (!versionId || !UUID_RE.test(versionId)) return null;             // not installed for this tenant (or a junk value)
  if (rec[localInstallKeys.active(pluginId)] === 'false') return null; // deactivated for this tenant

  const ds = await getDataSource();
  const version = await ds.getRepository(LocalPluginVersion).findOne({ where: { versionId } });
  if (!version || version.pluginId !== pluginId) return null;
  if (version.yankedAt) return null;                                   // yank = do not run, anywhere
  const grant = parseGrant(version.sandboxJson);
  if (!grant) return null;                                             // never approved
  const plugin = await ds.getRepository(LocalPlugin).findOne({ where: { pluginId } });
  if (!plugin || plugin.status !== 'active') return null;              // operator's platform-wide switch

  const policy = await readTrustPolicy();
  if (policy.requireSigned && !stillTrusted(policy, version)) return null;
  if (await bundleInfected(version)) return null;                     // a late `infected` verdict stops it everywhere

  const runtimeId = localRuntimePluginId(plugin.scopedName);
  const httpAllowlist = [...(grant.httpAllowlist ?? [])];
  for (const host of await egressHostsFromSettings(tenantId, runtimeId, grant.httpAllowlistFromSettings ?? [])) {
    if (!httpAllowlist.includes(host)) httpAllowlist.push(host);
  }
  const sandbox: SandboxConfig = {
    pluginVersionId: version.versionId,
    pluginId: runtimeId, // `local/<scopedName>`: scopes plugin_kv, settings, secrets, storage; never a marketplace id
    capabilities: grant.capabilities ?? [],
    httpAllowlist,
    limits: capLimits(grant.limits ?? {}, policy.maxLimits),
    // The endpoint settings that widen egress are the tenant's to set (config route), never the plugin's (settings.set).
    protectedSettingKeys: [...(grant.httpAllowlistFromSettings ?? [])],
  };
  const { bundleKey, bundleSha256 } = version;
  // Re-hashed on every cold load: a bundle swapped or corrupted in storage is refused, not run.
  const getBundle = (): Promise<string> => loadBundleCode(bundleKey, bundleSha256);
  return { plugin, version, sandbox, getBundle };
}

export interface LocalProviderContribution {
  pluginId: string;
  point: string;
  key: string;
  metadata: Record<string, unknown>;
  secrets: ManifestFieldDecl[];
  sandbox: SandboxConfig;
  getBundle: () => Promise<string>;
}

/** Only a uuid plugin id: a deeper key is refused by the settings API, and must never reach a uuid column query. */
export const VERSION_KEY_RE = /^plugin\.local\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.version$/i;

type StoredManifest = {
  extensions?: Array<{ point?: string; key?: string; metadata?: Record<string, unknown> }>;
  config?: { secrets?: ManifestFieldDecl[] };
};

/** The tenant's installed, active, runnable local plugins contributing to `point`, one entry per manifest extension. */
export async function listInstalledLocalProviders(tenantId: string, point: string): Promise<LocalProviderContribution[]> {
  const all = await SettingService.getAllAsRecord(tenantId);
  const out: LocalProviderContribution[] = [];
  for (const [key, versionId] of Object.entries(all)) {
    const m = key.match(VERSION_KEY_RE);
    if (!m || !versionId) continue;
    const pluginId = m[1];
    if (all[localInstallKeys.active(pluginId)] === 'false') continue;
    const runnable = await resolveLocalPlugin(tenantId, pluginId);
    if (!runnable) continue;
    let manifest: StoredManifest = {};
    try { manifest = JSON.parse(runnable.version.manifestJson) as StoredManifest; } catch { continue; }
    const secrets = Array.isArray(manifest.config?.secrets) ? manifest.config!.secrets! : [];
    for (const ext of manifest.extensions ?? []) {
      if (ext.point !== point || !ext.key) continue;
      out.push({
        pluginId, point, key: ext.key, metadata: ext.metadata ?? {}, secrets,
        sandbox: runnable.sandbox, getBundle: runnable.getBundle,
      });
    }
  }
  return out;
}
