// Per-tenant install / activate / uninstall of an operator-uploaded local plugin. Operator-controlled: every caller is
// a GLOBAL route (`plugin_local.plugins.manage`); a tenant admin cannot install, and the projection keys are refused by
// the generic settings API. Single writer, in the marketplace's order, under one per-(tenant, plugin) advisory lock:
//   1. the `installs` ledger row (artifactType 'plugin', artifactId `local:<pluginId>`),
//   2. the `plugin.local.<pluginId>.{version,active}` settings the resolver reads,
// both inside the locked transaction (a failed projection write rolls the ledger row back, and a concurrent install
// and uninstall can never leave a ledger row without its projection or the other way round), then audit + webhook.
// Uninstall also purges the plugin's data, config and stored files in that tenant.

import { IsNull, Like } from 'typeorm';
import { getDataSource, withSystemRLS, withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db';
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { UploadedFile } from '@kuraykaraaslan-labs/storage/server/entities/uploaded_file.entity';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { Install } from '@kuraykaraaslan-labs/module_lifecycle/server/entities/install.entity';
import { Tenant } from '@kuraykaraaslan-labs/tenant/server/entities/tenant.entity';
import { PluginKv } from '@kuraykaraaslan-labs/plugin_runtime/server/entities/plugin_kv.entity';
import { localInstallKeys, localPluginArtifactId, localRuntimePluginId } from '@kuraykaraaslan-labs/plugin_runtime/server/broker/install-keys';
import { loadBundleCode } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/bundle-loader';
import { getBundleScanStatus } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/bundle-scan';
import { LocalPlugin } from './entities/local_plugin.entity';
import { LocalPluginVersion } from './entities/local_plugin_version.entity';
import { readTrustPolicy, stillTrusted } from './plugin_local.trust';
import { assertScanPassed } from './plugin_local.store.service';
import { VERSION_KEY_RE } from './plugin_local.resolve';
import type { LocalInstallView } from './plugin_local.types';

const conflict = (message: string) => new AppError(message, 409, ErrorCode.CONFLICT);
const notFound = (message: string) => new AppError(message, 404, ErrorCode.NOT_FOUND);

const installLock = (tenantId: string, pluginId: string) => `plugin_local:install:${tenantId}:${pluginId}`;
const tenantKeysLock = (tenantId: string) => `plugin_local:keys:${tenantId}`;

type LockedTx = Parameters<Parameters<typeof withTenantTransactionFor>[1]>[0];

/**
 * Run `fn` in the tenant's transaction holding the per-(tenant, plugin) install lock until it commits. `tenantWide`
 * first takes the tenant's key lock too (always in that order, so no deadlock with a caller holding only the plugin
 * lock): an install checks every other local plugin's keys, so two different plugins must not install at once.
 */
async function underInstallLock<T>(tenantId: string, pluginId: string, fn: (qr: LockedTx) => Promise<T>, opts: { tenantWide?: boolean } = {}): Promise<T> {
  return withTenantTransactionFor(tenantId, async (qr) => {
    if (opts.tenantWide) await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [tenantKeysLock(tenantId)]);
    await qr.query('SELECT pg_advisory_xact_lock(hashtext($1))', [installLock(tenantId, pluginId)]);
    return fn(qr);
  });
}

async function saveLedgerRow(qr: LockedTx, tenantId: string, pluginId: string, versionId: string, active: boolean, opts: { mustExist?: boolean } = {}): Promise<void> {
  const artifactId = localPluginArtifactId(pluginId);
  const repo = qr.manager.getRepository(Install);
  const existing = await repo.findOne({ where: { tenantId, artifactType: 'plugin', artifactId } });
  if (!existing && opts.mustExist) throw notFound('The plugin is not installed for this tenant.');
  await repo.save(repo.create({ ...(existing ?? {}), tenantId, artifactType: 'plugin', artifactId, version: versionId, active }));
}

/**
 * The plugin and the version to install: approved, not yanked, the scan finished clean (or scanning is off), the
 * signature still trusted when required.
 */
async function loadInstallable(pluginId: string, versionId?: string): Promise<{ plugin: LocalPlugin; version: LocalPluginVersion }> {
  const ds = await getDataSource();
  const plugin = await ds.getRepository(LocalPlugin).findOne({ where: { pluginId } });
  if (!plugin) throw notFound('Plugin not found.');
  if (plugin.status !== 'active') throw conflict('This plugin is disabled on the platform.');
  const wanted = versionId ?? plugin.currentVersionId;
  if (!wanted) throw conflict('This plugin has no approved version: approve a version before installing it.');
  const version = await ds.getRepository(LocalPluginVersion).findOne({ where: { versionId: wanted } });
  if (!version || version.pluginId !== pluginId) throw notFound('Plugin version not found.');
  if (version.yankedAt) throw conflict('This version was yanked and cannot be installed.');
  if (!version.sandboxJson) throw conflict('This version is not approved: approve its sandbox grant before installing it.');
  const policy = await readTrustPolicy();
  if (policy.requireSigned && !stillTrusted(policy, version)) {
    throw conflict('Signatures are required and this version is not signed by a currently trusted key.');
  }
  assertScanPassed((await getBundleScanStatus(version)).status, 'installed');
  return { plugin, version };
}

/** `<point>#<key>` of every provider a manifest contributes. */
function contributionKeys(manifestJson: string): string[] {
  try {
    const m = JSON.parse(manifestJson) as { extensions?: Array<{ point?: unknown; key?: unknown }> };
    return (m.extensions ?? []).flatMap((e) => (typeof e.point === 'string' && typeof e.key === 'string' ? [`${e.point}#${e.key}`] : []));
  } catch {
    return [];
  }
}

/**
 * Two local plugins in one tenant may not contribute the same key to the same point: hosts pick a provider by key, so
 * the later one would be shadowed (or shadow the first) silently. A marketplace plugin with the same key is not seen
 * here (Core cannot read the marketplace); the operator page lists each local plugin's points so the operator can check.
 */
async function assertNoKeyClash(tenantId: string, pluginId: string, version: LocalPluginVersion): Promise<void> {
  const mine = new Set(contributionKeys(version.manifestJson));
  if (!mine.size) return;
  const all = await SettingService.getAllAsRecord(tenantId);
  const ds = await getDataSource();
  for (const [key, otherVersionId] of Object.entries(all)) {
    const m = key.match(VERSION_KEY_RE);
    if (!m || m[1] === pluginId || !otherVersionId) continue;
    const other = await ds.getRepository(LocalPluginVersion).findOne({ where: { versionId: otherVersionId } });
    if (!other) continue;
    const clash = contributionKeys(other.manifestJson).filter((k) => mine.has(k));
    if (clash.length) {
      const owner = await ds.getRepository(LocalPlugin).findOne({ where: { pluginId: other.pluginId } });
      throw conflict(`Another local plugin installed for this tenant (${owner?.scopedName ?? other.pluginId}) already provides ${clash.join(', ')}.`);
    }
  }
}

export async function installLocal(tenantId: string, pluginId: string, actorId?: string, opts: { versionId?: string } = {}): Promise<{ versionId: string }> {
  // `tenants` is RLS-protected (a tenant sees only its own row); the operator's cross-tenant existence check runs on
  // the system path.
  const tenant = await withSystemRLS((qr) => qr.manager.getRepository(Tenant).findOne({ where: { tenantId } }));
  if (!tenant) throw notFound('Tenant not found.');
  const { plugin, version } = await loadInstallable(pluginId, opts.versionId);
  // Supply chain: the stored bundle must still hash to what was recorded at upload, refused here rather than at first run.
  await loadBundleCode(version.bundleKey, version.bundleSha256);

  const settingOpts = actorId ? { actorId } : undefined;
  await underInstallLock(tenantId, pluginId, async (qr) => {
    // Checked under the tenant-wide lock: outside it, two plugins providing the same key could both pass and both install.
    await assertNoKeyClash(tenantId, pluginId, version);
    await saveLedgerRow(qr, tenantId, pluginId, version.versionId, true);
    await SettingService.updateMany(
      tenantId,
      { [localInstallKeys.version(pluginId)]: version.versionId, [localInstallKeys.active(pluginId)]: 'true' },
      settingOpts,
    );
  }, { tenantWide: true });
  await SettingService.clearCache(tenantId);
  await AuditLogService.log({
    tenantId, actorId: actorId ?? null, action: 'plugin_local.install',
    resourceType: 'plugin', resourceId: localPluginArtifactId(pluginId),
    metadata: { scopedName: plugin.scopedName, versionId: version.versionId, version: version.version },
  });
  // Same event names as the marketplace; `source` tells the two payload shapes apart (README "Webhooks").
  WebhookService.dispatchEvent(tenantId, 'plugin.installed', {
    source: 'local', pluginId, scopedName: plugin.scopedName, versionId: version.versionId,
  }).catch(() => {});
  return { versionId: version.versionId };
}

export async function setLocalActive(tenantId: string, pluginId: string, active: boolean, actorId?: string): Promise<void> {
  const current = await underInstallLock(tenantId, pluginId, async (qr) => {
    const versionId = await SettingService.getValue(tenantId, localInstallKeys.version(pluginId));
    if (!versionId) throw notFound('The plugin is not installed for this tenant.');
    await saveLedgerRow(qr, tenantId, pluginId, versionId, active, { mustExist: true });
    await SettingService.updateMany(tenantId, { [localInstallKeys.active(pluginId)]: String(active) }, actorId ? { actorId } : undefined);
    return versionId;
  });
  await SettingService.clearCache(tenantId);
  await AuditLogService.log({
    tenantId, actorId: actorId ?? null, action: active ? 'plugin_local.activate' : 'plugin_local.deactivate',
    resourceType: 'plugin', resourceId: localPluginArtifactId(pluginId), metadata: { versionId: current },
  });
  WebhookService.dispatchEvent(tenantId, active ? 'plugin.activated' : 'plugin.deactivated', { source: 'local', pluginId, versionId: current }).catch(() => {});
}

/** Delete the files the plugin stored for this tenant (`<tenant>/plugins/local/<scopedName>/…`). Best effort. */
async function purgeStoredFiles(tenantId: string, runtimeId: string): Promise<number> {
  const prefix = `${tenantId}/plugins/${runtimeId}/`;
  const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await withTenantRepositoryFor(tenantId, UploadedFile, (repo) =>
    repo.find({ where: { tenantId, key: Like(`${escaped}%`), deletedAt: IsNull() } })).catch(() => [] as UploadedFile[]);
  let removed = 0;
  for (const row of rows) {
    if (!row.key.startsWith(prefix)) continue;
    await StorageService.deleteFile(tenantId, { key: row.key } as never).then(() => { removed++; }).catch(() => null);
  }
  return removed;
}

/**
 * Remove the plugin from one tenant: the ledger row and the projection (together, under the install lock), then the
 * plugin's KV data, its settings and secrets and the files it stored in that tenant. Nothing of the plugin is left
 * behind for a later install to find.
 */
export async function uninstallLocal(tenantId: string, pluginId: string, actorId?: string): Promise<{ rowsPurged: number; filesPurged: number }> {
  const plugin = await (await getDataSource()).getRepository(LocalPlugin).findOne({ where: { pluginId } });
  if (!plugin) throw notFound('Plugin not found.');
  const runtimeId = localRuntimePluginId(plugin.scopedName);
  const artifactId = localPluginArtifactId(pluginId);
  const opts = actorId ? { actorId } : undefined;
  await underInstallLock(tenantId, pluginId, async (qr) => {
    await qr.manager.getRepository(Install).delete({ tenantId, artifactType: 'plugin', artifactId });
    await SettingService.deleteByPrefix(tenantId, localInstallKeys.prefix(pluginId), opts);
  });
  // `deleteByPrefix` matches the prefix literally (LIKE wildcards escaped), so `a_b` never purges `a-b`'s config.
  await SettingService.deleteByPrefix(tenantId, `plugin:${runtimeId}:`, opts);
  await SettingService.deleteByPrefix(tenantId, `plugin_secret:${runtimeId}:`, opts);
  const res = await withTenantRepositoryFor(tenantId, PluginKv, (repo) => repo.delete({ tenantId, pluginId: runtimeId }));
  const rowsPurged = res.affected ?? 0;
  const filesPurged = await purgeStoredFiles(tenantId, runtimeId);
  await SettingService.clearCache(tenantId);
  await AuditLogService.log({
    tenantId, actorId: actorId ?? null, action: 'plugin_local.uninstall',
    resourceType: 'plugin', resourceId: artifactId, metadata: { scopedName: plugin.scopedName, rowsPurged, filesPurged },
  });
  WebhookService.dispatchEvent(tenantId, 'plugin.uninstalled', { source: 'local', pluginId, scopedName: plugin.scopedName }).catch(() => {});
  return { rowsPurged, filesPurged };
}

/**
 * Which tenants have the plugin installed (operator page). A cross-tenant read of the ledger, so it runs through the
 * RLS-bypassing system path; only GLOBAL routes behind `plugin_local.plugins.manage` call it.
 */
export async function listInstalls(pluginId: string): Promise<LocalInstallView[]> {
  const artifactId = localPluginArtifactId(pluginId);
  const rows = await withSystemRLS((qr) => qr.manager.getRepository(Install).find({ where: { artifactType: 'plugin', artifactId } }));
  if (!rows.length) return [];
  const versions = await (await getDataSource()).getRepository(LocalPluginVersion).find({ where: { pluginId } });
  const byId = new Map(versions.map((v) => [v.versionId, v.version]));
  return Promise.all(rows.map(async (r) => ({
    tenantId: r.tenantId,
    versionId: r.version,
    version: byId.get(r.version) ?? null,
    active: r.active,
    installedAt: r.installedAt ? new Date(r.installedAt).toISOString() : null,
    moduleEnabled: (await getEnabledModuleIds(r.tenantId)).has('plugin_local'),
  })));
}
