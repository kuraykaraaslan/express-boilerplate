// The operator's local plugin store (OD-139): upload a sandboxed bundle, approve its sandbox grant, yank a version,
// switch a plugin off platform-wide. System-scoped, ROOT-only: every caller is a ROOT route behind
// `plugin_local.plugins.manage`. Mirrors the marketplace's submitVersion + reviewVersion path with the shared Core
// helpers (bundle integrity, strict manifest validation, bundle scan), minus publishers, listings and payments.

import type { EntityManager } from 'typeorm';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import AuditLogService from '@kuraykaraaslan-labs/audit_log/server/audit_log.service';
import StorageService from '@kuraykaraaslan-labs/storage/server/storage.service';
import { registerStorageFolder } from '@kuraykaraaslan-labs/storage/server/storage.folders';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { evictPluginVersions } from '@kuraykaraaslan-labs/plugin_runtime/server/rpc/host-client';
import { localRuntimePluginId } from '@kuraykaraaslan-labs/plugin_runtime/server/broker/install-keys';
import { sha256Hex, assertDeclaredChecksum, MAX_BUNDLE_BYTES } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/bundle-integrity';
import { getBundleScanStatus, type BundleScanStatus } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/bundle-scan';
import { builtinPlugin } from '@kuraykaraaslan-labs/plugin_runtime/server/bundle/builtin-bundles';
import {
  parseSandboxedManifest, validateSandbox, capLimits, highestSemver, parseSemver, compareSemver, formatSemver, LIMIT_KEYS,
  type SandboxGrant, type SandboxedManifest,
} from '@kuraykaraaslan-labs/plugin_runtime/server/manifest/plugin-manifest';
import { LocalPlugin, type LocalPluginStatus } from './entities/local_plugin.entity';
import { LocalPluginVersion } from './entities/local_plugin_version.entity';
import { readTrustPolicy, verifyAgainstTrusted, stillTrusted } from './plugin_local.trust';
import type { ApprovedGrant, LocalPluginView, LocalVersionView, UploadInput } from './plugin_local.types';

// The folder a plugin bundle is stored in: not a base folder, so every uploader registers it (an unregistered folder is refused with INVALID_FOLDER_NAME).
registerStorageFolder('plugin-bundles');

/** `name` or `@scope/name`: lowercase, never `local/…`, never a marketplace-looking `@…` clash (the runtime id is `local/<this>`). */
export const SCOPED_NAME_RE = /^(?:@[a-z0-9][a-z0-9-]{0,38}\/)?[a-z0-9][a-z0-9_-]{0,63}$/;
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

const bad = (message: string) => new AppError(message, 400, ErrorCode.VALIDATION_ERROR);
const notFound = (message: string) => new AppError(message, 404, ErrorCode.NOT_FOUND);
const conflict = (message: string) => new AppError(message, 409, ErrorCode.CONFLICT);

/**
 * Approval and install need a finished, passing scan: `clean`, or `skipped` (scanning is off on this platform).
 * `pending` (the async scanner has not answered yet) and `error` are refused until it does; `infected` never passes.
 */
export function assertScanPassed(status: BundleScanStatus | null, what: 'approved' | 'installed'): void {
  if (status === 'clean' || status === 'skipped') return;
  if (status === 'infected') throw new AppError(`This bundle failed the virus scan and cannot be ${what}.`, 422, ErrorCode.VALIDATION_ERROR);
  if (status === 'pending') throw conflict(`The bundle's virus scan has not finished yet; it can be ${what} once the scan reports clean.`);
  throw conflict(`The bundle's virus scan did not complete (${status ?? 'no bundle'}); re-upload the version or retry the scan before it can be ${what}.`);
}

/** Run a pure validator and turn its Error into a 400. */
function validated<T>(fn: () => T): T {
  try { return fn(); } catch (e) { throw bad((e as Error).message); }
}

export function parseStoredManifest(manifestJson: string): SandboxedManifest {
  return validated(() => parseSandboxedManifest(manifestJson));
}

export function parseGrant(sandboxJson: string | null): ApprovedGrant | null {
  if (!sandboxJson) return null;
  try { return JSON.parse(sandboxJson) as ApprovedGrant; } catch { return null; }
}

/** Decode the bundle strictly: real base64 only (Buffer.from would silently drop junk), 1 byte to 5 MB. */
export function decodeBundle(bundleBase64: string): Buffer {
  const b64 = bundleBase64.replace(/\s+/g, '');
  if (!b64 || b64.length % 4 !== 0 || !BASE64_RE.test(b64)) throw bad('bundleBase64 must be base64.');
  // 4 base64 chars carry 3 bytes: refuse before decoding something far over the cap.
  if ((b64.length / 4) * 3 - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0) > MAX_BUNDLE_BYTES) {
    throw new AppError(`The bundle is too large (max ${MAX_BUNDLE_BYTES / 1_000_000} MB).`, 413, ErrorCode.VALIDATION_ERROR);
  }
  const buffer = Buffer.from(b64, 'base64');
  if (buffer.byteLength === 0) throw bad('The bundle is empty.');
  return buffer;
}

/**
 * Upload a version (creating the plugin on its first upload). The manifest is validated strictly, the server hashes
 * the bytes, a declared checksum must agree, a signature must verify against an operator-registered key (and is
 * required when `pluginLocalRequireSigned` is on), and the bundle goes through storage's virus scan, which refuses an
 * infected file. The version lands unapproved: nothing can install or run it until `approveVersion`.
 */
export async function uploadVersion(input: UploadInput, actorId?: string): Promise<{ plugin: LocalPlugin; version: LocalPluginVersion }> {
  const parsed = parseStoredManifest(input.manifestJson);
  const scopedName = (input.scopedName ?? parsed.manifest.id).trim();
  if (!SCOPED_NAME_RE.test(scopedName)) throw bad('scopedName must be `name` or `@scope/name` (lowercase letters, digits, - and _).');
  const versionLabel = parsed.manifest.version;

  const buffer = decodeBundle(input.bundleBase64);
  const bundleSha256 = sha256Hex(buffer);
  validated(() => assertDeclaredChecksum(input.bundleSha256, bundleSha256));

  // Authenticity: ONLY against keys the operator registered out of band, never one that arrives with the upload.
  const policy = await readTrustPolicy();
  let signerKid: string | null = null;
  if (input.signature) signerKid = verifyAgainstTrusted(policy, bundleSha256, input.signature, input.signerKid);
  else if (input.signerKid) throw bad('signerKid was given without a signature.');
  else if (policy.requireSigned) throw bad('This platform requires signed plugin bundles: sign the bundle with a trusted key.');

  // A cheap early refusal before the bytes are stored; repeated under the lock below, which is the one that counts.
  const ds = await getDataSource();
  await assertVersionIncreases(ds, scopedName, versionLabel);

  // Third-party code: the one server upload that MUST be scanned. Sync mode refuses an infected bundle here (422);
  // async mode stores it `pending`, and approval/install wait for a clean verdict (the resolver also refuses a late
  // `infected` one).
  const stored = await StorageService.uploadServerBuffer(ROOT_TENANT_ID, {
    buffer,
    filename: `local-${scopedName.replace(/[^a-z0-9_.-]/gi, '_')}-${versionLabel}.js`,
    contentType: 'application/javascript',
    folder: 'plugin-bundles',
    trusted: true,
    scan: true,
  });

  // Concurrent uploads of one scopedName serialise on an advisory lock: the version check, the plugin row and the
  // version row are one decision. A loser gets a 409 and its stored bundle is removed, never left orphaned.
  let result: { plugin: LocalPlugin; version: LocalPluginVersion };
  try {
    result = await ds.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plugin_local:upload:${scopedName}`]);
      await assertVersionIncreases(manager, scopedName, versionLabel);
      return insertVersion(manager, {
        scopedName, name: parsed.manifest.name, versionLabel, manifestJson: input.manifestJson, stored, bundleSha256,
        signature: signerKid ? input.signature! : null, signerKid, actorId,
      });
    });
  } catch (e) {
    await StorageService.deleteFile(ROOT_TENANT_ID, { key: stored.key } as never).catch(() => null);
    if ((e as { code?: string })?.code === '23505') throw conflict('This plugin version was uploaded concurrently: reload and try again.');
    throw e;
  }
  const { plugin, version } = result;

  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID, actorId: actorId ?? null, action: 'plugin_local.version.upload',
    resourceType: 'plugin_local_version', resourceId: version.versionId,
    metadata: { pluginId: plugin.pluginId, scopedName, version: versionLabel, bundleSha256, signerKid },
  });
  return { plugin, version };
}

/**
 * Register a built-in plugin, one whose bundle ships with the platform (plugin_runtime builtin-bundles.ts, e.g. the local disk
 * storage plugin `@local/storage`), as a version of the local plugin store: no upload, no storage object, no scan (it never was a
 * file; its bundle key is `builtin:<scopedName>` and loads from code). This is how a platform with no storage yet gets its first
 * storage backend. Idempotent: the version that already carries the built-in's checksum is answered as it is. Like an upload,
 * the version lands unapproved; the operator (or `npm run storage:local`) approves and installs it.
 */
export async function registerBuiltinVersion(scopedName: string, actorId?: string): Promise<{ plugin: LocalPlugin; version: LocalPluginVersion; created: boolean }> {
  const builtin = builtinPlugin(scopedName);
  if (!builtin) throw bad(`There is no built-in plugin named ${scopedName}.`);
  const parsed = parseStoredManifest(builtin.manifestJson);
  const ds = await getDataSource();
  const result = await ds.transaction(async (manager) => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`plugin_local:upload:${scopedName}`]);
    const existing = await manager.getRepository(LocalPlugin).findOne({ where: { scopedName } });
    if (existing) {
      const same = await manager.getRepository(LocalPluginVersion).findOne({ where: { pluginId: existing.pluginId, bundleSha256: builtin.bundleSha256 } });
      if (same) return { plugin: existing, version: same, created: false };
    }
    await assertVersionIncreases(manager, scopedName, parsed.manifest.version);
    const inserted = await insertVersion(manager, {
      scopedName, name: parsed.manifest.name, versionLabel: parsed.manifest.version, manifestJson: builtin.manifestJson,
      stored: { key: builtin.bundleKey, uploadedFileId: null }, bundleSha256: builtin.bundleSha256, signature: null, signerKid: null, actorId,
    });
    return { ...inserted, created: true };
  });
  if (result.created) {
    await AuditLogService.log({
      tenantId: ROOT_TENANT_ID, actorId: actorId ?? null, action: 'plugin_local.version.upload',
      resourceType: 'plugin_local_version', resourceId: result.version.versionId,
      metadata: { pluginId: result.plugin.pluginId, scopedName, version: result.version.version, bundleSha256: builtin.bundleSha256, builtin: true },
    });
  }
  return result;
}

type Manager = Pick<EntityManager, 'getRepository'>;

/** The new version must be strictly greater than every version already uploaded for the plugin (yanked included). */
async function assertVersionIncreases(manager: Manager, scopedName: string, versionLabel: string): Promise<void> {
  const existing = await manager.getRepository(LocalPlugin).findOne({ where: { scopedName } });
  if (!existing) return;
  const prior = await manager.getRepository(LocalPluginVersion).find({ where: { pluginId: existing.pluginId } });
  const highest = highestSemver(prior.map((v) => v.version));
  const next = parseSemver(versionLabel)!;
  if (highest && compareSemver(next, highest) <= 0) {
    throw conflict(`version must be greater than the latest uploaded version (${formatSemver(highest)}).`);
  }
}

async function insertVersion(manager: Manager, v: {
  scopedName: string; name: string; versionLabel: string; manifestJson: string;
  stored: { key: string; uploadedFileId?: string | null }; bundleSha256: string;
  signature: string | null; signerKid: string | null; actorId?: string;
}): Promise<{ plugin: LocalPlugin; version: LocalPluginVersion }> {
  const pluginRepo = manager.getRepository(LocalPlugin);
  const versionRepo = manager.getRepository(LocalPluginVersion);
  const existing = await pluginRepo.findOne({ where: { scopedName: v.scopedName } });
  const plugin = existing ?? await pluginRepo.save(pluginRepo.create({
    scopedName: v.scopedName, name: v.name, status: 'active', currentVersionId: null, createdBy: v.actorId ?? null,
  }));
  if (existing && existing.name !== v.name) {
    existing.name = v.name;
    await pluginRepo.save(existing);
  }
  const { stored, bundleSha256, signerKid, actorId } = v;
  const version = await versionRepo.save(versionRepo.create({
    pluginId: plugin.pluginId,
    version: v.versionLabel,
    manifestJson: v.manifestJson,
    sandboxJson: null,
    bundleKey: stored.key,
    bundleUploadedFileId: stored.uploadedFileId ?? null,
    bundleSha256,
    signature: v.signature,
    signerKid,
    signatureVerified: signerKid !== null,
    uploadedBy: actorId ?? null,
    approvedBy: null,
    approvedAt: null,
    yankedAt: null,
    yankedReason: null,
  }));
  return { plugin, version };
}

/**
 * The approved grant may narrow the request, never widen it: every entry must be one the manifest asked for, and a
 * limit the manifest declared may only be lowered (a limit it left out is the operator's call, up to the platform cap).
 */
function assertWithinRequest(grant: SandboxGrant, requested: SandboxGrant): void {
  const extra = [
    ...grant.capabilities.filter((c) => !requested.capabilities.includes(c)).map((c) => `capability '${c}'`),
    ...grant.httpAllowlist.filter((h) => !requested.httpAllowlist.includes(h)).map((h) => `host '${h}'`),
    ...grant.httpAllowlistFromSettings.filter((k) => !requested.httpAllowlistFromSettings.includes(k)).map((k) => `endpoint setting '${k}'`),
    ...LIMIT_KEYS.flatMap((k) => {
      const want = requested.limits[k];
      const got = grant.limits[k];
      return typeof want === 'number' && typeof got === 'number' && got > want ? [`limit '${k}' above the requested ${want}`] : [];
    }),
  ];
  if (extra.length) throw bad(`The grant may only narrow what the manifest requests; not requested: ${extra.join(', ')}.`);
}

async function loadVersion(versionId: string): Promise<LocalPluginVersion> {
  const v = await (await getDataSource()).getRepository(LocalPluginVersion).findOne({ where: { versionId } });
  if (!v) throw notFound('Plugin version not found.');
  return v;
}

/** currentVersionId = the highest approved, non-yanked version (null when none). */
async function recomputeCurrent(pluginId: string): Promise<string | null> {
  const ds = await getDataSource();
  const versions = await ds.getRepository(LocalPluginVersion).find({ where: { pluginId } });
  const runnable = versions.filter((v) => v.sandboxJson && !v.yankedAt);
  const best = runnable
    .map((v) => ({ v, s: parseSemver(v.version) }))
    .filter((x) => x.s !== null)
    .sort((a, b) => compareSemver(a.s!, b.s!))
    .pop();
  const currentVersionId = best?.v.versionId ?? null;
  const repo = ds.getRepository(LocalPlugin);
  const plugin = await repo.findOne({ where: { pluginId } });
  if (plugin && plugin.currentVersionId !== currentVersionId) {
    plugin.currentVersionId = currentVersionId;
    await repo.save(plugin);
  }
  return currentVersionId;
}

/**
 * Approve a version's sandbox grant (the operator is the reviewer). `grant` defaults to what the manifest requests;
 * it may only narrow it, and its limits are capped at the platform maximum (`loadRuntimeConfig().defaultLimits`,
 * lowered by `pluginLocalMaxLimits`). Refused for a yanked version, an infected bundle, and, while signatures are
 * required, a version whose signature no longer verifies against a trusted key.
 */
export async function approveVersion(versionId: string, grantInput: unknown, actorId?: string): Promise<LocalPluginVersion> {
  const version = await loadVersion(versionId);
  if (version.yankedAt) throw conflict('A yanked version cannot be approved.');
  const parsed = parseStoredManifest(version.manifestJson);
  const requested = parsed.sandbox;
  const settingKeys = parsed.config.settings.map((s) => s.key);
  const grant = grantInput === undefined || grantInput === null
    ? requested
    : validated(() => validateSandbox(grantInput, { requireRuntime: false, settingKeys }));
  assertWithinRequest(grant, requested);

  const policy = await readTrustPolicy();
  if (policy.requireSigned && !stillTrusted(policy, version)) {
    throw conflict('Signatures are required and this version is not signed by a currently trusted key.');
  }
  assertScanPassed((await getBundleScanStatus(version)).status, 'approved');

  // Limits the grant leaves out fall back to what the manifest asked for, and everything is capped.
  const limits = capLimits({ ...requested.limits, ...grant.limits }, policy.maxLimits);
  const approved: ApprovedGrant = {
    capabilities: grant.capabilities,
    httpAllowlist: grant.httpAllowlist,
    httpAllowlistFromSettings: grant.httpAllowlistFromSettings,
    limits,
  };
  const repo = (await getDataSource()).getRepository(LocalPluginVersion);
  version.sandboxJson = JSON.stringify(approved);
  version.approvedBy = actorId ?? null;
  version.approvedAt = new Date();
  await repo.save(version);
  await recomputeCurrent(version.pluginId);
  // A re-approval may narrow a grant that is already running; drop warm isolates so the next call starts clean.
  await evictPluginVersions([version.versionId]).catch(() => null);
  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID, actorId: actorId ?? null, action: 'plugin_local.version.approve',
    resourceType: 'plugin_local_version', resourceId: version.versionId,
    metadata: { pluginId: version.pluginId, version: version.version, grant: approved },
  });
  return version;
}

/** Yank a version: never installable or runnable again, and every warm isolate running it is evicted. */
export async function yankVersion(versionId: string, reason: string | undefined, actorId?: string): Promise<LocalPluginVersion> {
  const version = await loadVersion(versionId);
  if (version.yankedAt) return version;
  const repo = (await getDataSource()).getRepository(LocalPluginVersion);
  version.yankedAt = new Date();
  version.yankedReason = reason?.slice(0, 500) || null;
  await repo.save(version);
  await recomputeCurrent(version.pluginId);
  await evictPluginVersions([version.versionId]).catch(() => null);
  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID, actorId: actorId ?? null, action: 'plugin_local.version.yank',
    resourceType: 'plugin_local_version', resourceId: version.versionId,
    metadata: { pluginId: version.pluginId, version: version.version, reason: version.yankedReason },
  });
  return version;
}

/** The operator's platform-wide switch: a disabled plugin runs nowhere (installs stay and resume when re-enabled). */
export async function setPluginStatus(pluginId: string, status: LocalPluginStatus, actorId?: string): Promise<LocalPlugin> {
  const ds = await getDataSource();
  const repo = ds.getRepository(LocalPlugin);
  const plugin = await repo.findOne({ where: { pluginId } });
  if (!plugin) throw notFound('Plugin not found.');
  if (plugin.status === status) return plugin;
  plugin.status = status;
  await repo.save(plugin);
  if (status === 'disabled') {
    const versions = await ds.getRepository(LocalPluginVersion).find({ where: { pluginId } });
    await evictPluginVersions(versions.map((v) => v.versionId)).catch(() => null);
  }
  await AuditLogService.log({
    tenantId: ROOT_TENANT_ID, actorId: actorId ?? null, action: status === 'disabled' ? 'plugin_local.plugin.disable' : 'plugin_local.plugin.enable',
    resourceType: 'plugin_local', resourceId: pluginId, metadata: { scopedName: plugin.scopedName },
  });
  return plugin;
}

function versionView(v: LocalPluginVersion, scanStatus: string | null): LocalVersionView {
  let requested: SandboxGrant = { capabilities: [], httpAllowlist: [], httpAllowlistFromSettings: [], limits: {} };
  let points: string[] = [];
  try {
    const m = parseSandboxedManifest(v.manifestJson);
    requested = m.sandbox;
    points = [...new Set(m.extensions.map((e) => e.point))];
  } catch { /* validated at upload; a point retired since then makes it unparseable — shown with an empty request */ }
  return {
    versionId: v.versionId,
    version: v.version,
    createdAt: new Date(v.createdAt).toISOString(),
    bundleSha256: v.bundleSha256,
    signatureVerified: v.signatureVerified,
    signerKid: v.signerKid,
    approved: !!v.sandboxJson,
    approvedAt: v.approvedAt ? new Date(v.approvedAt).toISOString() : null,
    yanked: !!v.yankedAt,
    yankedReason: v.yankedReason,
    requested,
    grant: parseGrant(v.sandboxJson),
    points,
    scanStatus,
  };
}

/** Every local plugin with its versions, newest first (the operator page). */
export async function listPlugins(): Promise<LocalPluginView[]> {
  const ds = await getDataSource();
  const plugins = await ds.getRepository(LocalPlugin).find({ order: { createdAt: 'DESC' } });
  const versions = await ds.getRepository(LocalPluginVersion).find({ order: { createdAt: 'DESC' } });
  const out: LocalPluginView[] = [];
  for (const p of plugins) {
    const own = versions.filter((v) => v.pluginId === p.pluginId);
    const views = await Promise.all(own.map(async (v) => versionView(v, (await getBundleScanStatus(v)).status)));
    out.push({
      pluginId: p.pluginId,
      scopedName: p.scopedName,
      runtimePluginId: localRuntimePluginId(p.scopedName),
      name: p.name,
      status: p.status,
      currentVersionId: p.currentVersionId,
      createdAt: new Date(p.createdAt).toISOString(),
      versions: views,
    });
  }
  return out;
}
