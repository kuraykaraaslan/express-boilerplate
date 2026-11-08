// Tenant-scoped configuration of an installed local plugin: the same storage scheme and rules as the marketplace
// (plugin_runtime/server/config/plugin-config.service): settings at `plugin:local/<scopedName>:<key>`, secrets encrypted
// at `plugin_secret:local/<scopedName>:<key>`, write-only. A tenant sees and configures only what the operator
// installed for it.

import { getDataSource } from '@kuraykaraaslan-labs/db';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import { localInstallKeys, localPluginArtifactId, localRuntimePluginId } from '@kuraykaraaslan-labs/plugin_runtime/server/broker/install-keys';
import {
  readPluginConfig, writePluginConfig, type PluginConfigSubject, type PluginFieldDecl,
} from '@kuraykaraaslan-labs/plugin_runtime/server/config/plugin-config.service';
import { LocalPlugin } from './entities/local_plugin.entity';
import { LocalPluginVersion } from './entities/local_plugin_version.entity';
import { parseGrant } from './plugin_local.store.service';
import { VERSION_KEY_RE } from './plugin_local.resolve';
import { UUID_RE } from './plugin_local.types';

export interface LocalPluginConfigView {
  pluginId: string;
  scopedName: string;
  name: string;
  version: string;
  active: boolean;
  points: string[];
  settings: Array<PluginFieldDecl & { value: string }>;
  secrets: Array<PluginFieldDecl & { set: boolean }>;
  configured: boolean;
}

type Loaded = PluginConfigSubject & { plugin: LocalPlugin; version: LocalPluginVersion; active: boolean; points: string[] };

/** The plugin as installed for THIS tenant (its pinned, approved version), or null. */
async function loadInstalled(tenantId: string, pluginId: string): Promise<Loaded | null> {
  if (!UUID_RE.test(pluginId)) return null;
  const rec = await SettingService.getByKeys(tenantId, [localInstallKeys.version(pluginId), localInstallKeys.active(pluginId)]);
  const versionId = rec[localInstallKeys.version(pluginId)];
  if (!versionId || !UUID_RE.test(versionId)) return null;
  const ds = await getDataSource();
  const version = await ds.getRepository(LocalPluginVersion).findOne({ where: { versionId } });
  if (!version || version.pluginId !== pluginId) return null;
  const grant = parseGrant(version.sandboxJson);
  if (!grant) return null;
  const plugin = await ds.getRepository(LocalPlugin).findOne({ where: { pluginId } });
  if (!plugin) return null;
  let config: PluginConfigSubject['config'] = {};
  let points: string[] = [];
  try {
    const m = JSON.parse(version.manifestJson) as { config?: PluginConfigSubject['config']; extensions?: Array<{ point?: string }> };
    config = m.config ?? {};
    points = [...new Set((m.extensions ?? []).flatMap((e) => (typeof e.point === 'string' ? [e.point] : [])))];
  } catch { /* validated at upload */ }
  return {
    pluginId: localRuntimePluginId(plugin.scopedName),
    config,
    egressSettings: grant.httpAllowlistFromSettings ?? [],
    plugin, version, points,
    active: rec[localInstallKeys.active(pluginId)] !== 'false',
  };
}

function view(m: Loaded, values: Awaited<ReturnType<typeof readPluginConfig>>): LocalPluginConfigView {
  return {
    pluginId: m.plugin.pluginId, scopedName: m.plugin.scopedName, name: m.plugin.name, version: m.version.version,
    active: m.active, points: m.points, ...values,
  };
}

export async function getLocalPluginConfig(tenantId: string, pluginId: string): Promise<LocalPluginConfigView | null> {
  const m = await loadInstalled(tenantId, pluginId);
  return m ? view(m, await readPluginConfig(tenantId, m)) : null;
}

export async function setLocalPluginConfig(
  tenantId: string,
  pluginId: string,
  input: { settings?: Record<string, unknown>; secrets?: Record<string, unknown> },
  actorId?: string,
): Promise<LocalPluginConfigView | null> {
  const m = await loadInstalled(tenantId, pluginId);
  if (!m) return null;
  const written = await writePluginConfig(tenantId, m, input, actorId);
  if (written.changed) {
    await AuditLogService.log({
      tenantId, actorId: actorId ?? null, action: 'plugin_local.configure',
      resourceType: 'plugin', resourceId: localPluginArtifactId(pluginId),
      metadata: { settings: written.settings, secretsSet: written.secretsSet, ...(written.secretsCleared.length && { secretsCleared: written.secretsCleared }) },
    });
  }
  return getLocalPluginConfig(tenantId, pluginId);
}


/** Every local plugin the operator installed for this tenant, with its config view (the tenant page). */
export async function listTenantLocalPlugins(tenantId: string): Promise<LocalPluginConfigView[]> {
  const all = await SettingService.getAllAsRecord(tenantId);
  const ids = Object.keys(all).flatMap((k) => { const m = k.match(VERSION_KEY_RE); return m && all[k] ? [m[1]] : []; });
  const out: LocalPluginConfigView[] = [];
  for (const id of ids) {
    const v = await getLocalPluginConfig(tenantId, id);
    if (v) out.push(v);
  }
  return out;
}
