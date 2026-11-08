import { effectiveExtensions, folderUploadPolicy } from './storage.upload-policy'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { listExternalContributions, type ExternalContribution } from '@kuraykaraaslan-labs/common/server/external-extensions'
import type BaseStorageProvider from './providers/base.provider'
import { IsolatedStorageProvider, type ResolvedStorageConfig } from './providers/isolated.provider'
import { LocalDiskProvider, LOCAL_PROVIDER_KEY } from './providers/local-disk.provider'
import { getLocalStorageConfig } from './storage.local.config'
import { StorageProviderType } from './storage.enums'
import { S3Config } from './storage.types'
import { STORAGE_MESSAGES } from './storage.messages'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { ROOT_TENANT_ID, isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { STORAGE_KEYS } from './storage.setting.keys'
import { scopeOfSource, type StorageSource } from './storage.source'
import { expandMimeGroups } from './storage.mime-groups'
import { effectiveDirectUploadMaxBytes, effectiveMaxUploadBytes, type UploadValidationPolicy } from './storage.validation'

/** Extension point storage backends contribute into: sandboxed plugins only (bucket plugins, and `@local/storage` for the key `local`). */
const STORAGE_PROVIDER_POINT = 'storage:provider'

/**
 * How long a plugin's `getConfig` answer is reused. Every storage operation
 * resolves a provider, and each getConfig is a full trip through the plugin-host
 * (a sandbox borrow plus broker hops), so a burst of uploads paid it per file.
 * Kept short because nothing invalidates it when the tenant edits the plugin's
 * settings: for at most this long, URLs built on this process may still name the
 * previous bucket or endpoint (the PUT itself always reads fresh settings).
 */
const PLUGIN_CONFIG_TTL_MS = 15_000

/**
 * In-flight or settled getConfig per (tenant, whose install serves it, provider, plugin version). Whose install is part of the
 * key (phase 53.4): after a setting level change the tenant's own bucket and the platform's never answer for each other.
 */
const pluginConfigCache = new Map<string, { at: number; value: Promise<ResolvedStorageConfig> }>()

function cachedPluginConfig(tenantId: string, ext: ExternalContribution): Promise<ResolvedStorageConfig> {
  const key = `${tenantId}|${ext.from ?? 'own'}|${ext.key}|${ext.version ?? ''}`
  const now = Date.now()
  const hit = pluginConfigCache.get(key)
  if (hit && now - hit.at < PLUGIN_CONFIG_TTL_MS) return hit.value
  // Concurrent callers share one in-flight call; a failure is dropped at once so
  // the next operation retries instead of reusing the error for the whole TTL.
  const value = (ext.invoke('getConfig', {}) as Promise<ResolvedStorageConfig>).catch((e) => {
    if (pluginConfigCache.get(key)?.value === value) pluginConfigCache.delete(key)
    throw e
  })
  pluginConfigCache.set(key, { at: now, value })
  // Expired entries of tenants that stopped uploading would otherwise stay forever.
  if (pluginConfigCache.size > 1_000) {
    for (const [k, v] of pluginConfigCache) if (now - v.at >= PLUGIN_CONFIG_TTL_MS) pluginConfigCache.delete(k)
  }
  return value
}

/** Test seam: forget every cached plugin config. */
export function clearPluginConfigCache(): void {
  pluginConfigCache.clear()
}

/**
 * Read storage settings from SettingService and build S3Config for a tenant: by default the side its setting level picks, or
 * with `scope` (phase 53.5) a given side, the one an object was stored on: the root tenant's rows ('root') or the tenant's own
 * ('own').
 */
export async function getStorageSettings(tenantId: string, scope?: 'own' | 'root'): Promise<{ providerName: StorageProviderType; config: S3Config }> {
  const settings: Record<string, string | undefined> = scope === 'root'
    ? await SettingService.getByKeys(ROOT_TENANT_ID, [...STORAGE_KEYS])
    : scope === 'own'
      ? await SettingService.getAllAsRecord(tenantId)
      : await SettingService.getByKeys(tenantId, [...STORAGE_KEYS])

  const providerName = (settings.storageProvider || 'aws-s3') as StorageProviderType

  const config: S3Config = {
    bucket: settings.s3Bucket || '',
    region: settings.s3Region || 'us-east-1',
    accessKeyId: settings.s3AccessKey || '',
    secretAccessKey: settings.s3SecretKey || '',
    endpoint: settings.s3Endpoint || undefined,
  }

  return { providerName, config }
}

/**
 * The tenant's effective per-file cap alone, for the pre-parse size check in the
 * upload routes (one setting, not the whole policy). An unreadable setting falls
 * back the same way `getValidationPolicy` does.
 */
export async function getMaxUploadBytes(tenantId: string): Promise<number> {
  const s = await SettingService.getByKeys(tenantId, ['maxFileSizeMb']).catch(() => ({} as Record<string, string>))
  return effectiveMaxUploadBytes(s.maxFileSizeMb)
}

/**
 * Resolve the per-tenant upload validation policy from settings. `direct` asks
 * for the cap of a browser-direct upload (`effectiveDirectUploadMaxBytes`), which
 * is not bound by the multipart request ceiling.
 */
export async function getValidationPolicy(tenantId: string, opts: { direct?: boolean; folder?: string } = {}): Promise<UploadValidationPolicy> {
  const s = await SettingService.getByKeys(tenantId, ['maxFileSizeMb', 'allowedExtensions', 'allowedMimeGroups', 'allowedMimeTypes', 'imageStripExif']).catch(() => ({} as Record<string, string>))

  // Effective MIME allowlist = selected groups (expanded) ∪ explicit MIME types.
  // Both empty → unrestricted (the provider-level type checks still apply).
  const groups = (s.allowedMimeGroups ?? '').split(',').map((g) => g.trim().toLowerCase()).filter(Boolean)
  const explicit = (s.allowedMimeTypes ?? '').split(',').map((m) => m.trim().toLowerCase()).filter(Boolean)
  const allowedMimeTypes = [...new Set([...expandMimeGroups(groups), ...explicit])]

  // 38-security 4.5: deny by default. No tenant list means the curated default (never html / svg / xml), plus the folder's own extras.
  const tenantExtensions = (s.allowedExtensions ?? '').split(',').map((e) => e.trim().toLowerCase().replace(/^\./, '')).filter(Boolean)
  const tenantMax = opts.direct ? effectiveDirectUploadMaxBytes(s.maxFileSizeMb) : effectiveMaxUploadBytes(s.maxFileSizeMb)
  const folderMax = folderUploadPolicy(opts.folder).maxBytes
  return {
    maxBytes: folderMax ? Math.min(tenantMax, folderMax) : tenantMax,
    allowedExtensions: effectiveExtensions(tenantExtensions, opts.folder),
    allowedMimeTypes,
    stripExif: s.imageStripExif !== 'false', // strip by default (privacy)
  }
}

/**
 * Resolve a storage provider for a tenant. Backends are SANDBOXED plugins (the storage plugin family) resolved per-tenant via
 * the external-contributions bridge; nothing is built in. A bucket plugin's non-secret config (bucket/region/endpoint) comes
 * from its `getConfig` op (cached briefly per tenant and plugin version) so the facade can build URLs synchronously; the
 * SigV4-signed PutObject/DeleteObject egress runs in the isolate. The key `local` is the local disk plugin (`@local/storage`):
 * its writes run in the isolate through the `localfs` capability, and the host facade (`LocalDiskProvider`) builds the signed
 * app URLs and the server paths from the platform's `storageLocalDir`, so it needs no `getConfig`.
 */
export async function getProvider(
  tenantId: string,
  providerName?: StorageProviderType,
  opts: { source?: string | null } = {},
): Promise<{ provider: BaseStorageProvider; resolvedName: StorageProviderType; source: StorageSource }> {
  // Phase 53.5: an object stored on one side is read and deleted on that side, whatever the module's setting level is now.
  const scope = scopeOfSource(tenantId, opts.source)
  const exts = scope
    ? await listExternalContributions(tenantId, STORAGE_PROVIDER_POINT, { scope })
    : await listExternalContributions(tenantId, STORAGE_PROVIDER_POINT)
  if (exts.length === 0) {
    throw new AppError(STORAGE_MESSAGES.PROVIDER_NOT_FOUND, 400, ErrorCode.VALIDATION_ERROR)
  }
  // `getStorageSettings` reads the tenant's storage settings (also used by the scan
  // path) — it throws if settings are unavailable, which must fail the upload.
  const { providerName: defaultName } = scope ? await getStorageSettings(tenantId, scope) : await getStorageSettings(tenantId)
  const wanted = providerName || defaultName
  // Strict: storage must NOT silently switch backends (it would write to the wrong
  // bucket), so an unknown/not-installed provider is an error, not a fallback.
  const found = exts.find((c) => c.key === wanted)
  if (!found) {
    throw new AppError(`${STORAGE_MESSAGES.PROVIDER_NOT_FOUND}: ${wanted}`, 400, ErrorCode.VALIDATION_ERROR)
  }
  if (found.key === LOCAL_PROVIDER_KEY) {
    // The disk is this server's, whoever installed the plugin: the platform's storage (counted, never free).
    const provider = new LocalDiskProvider(found.invoke, await getLocalStorageConfig(), tenantId)
    return { provider, resolvedName: found.key as StorageProviderType, source: 'platform' }
  }
  const cfg = await cachedPluginConfig(tenantId, found)
  // Only the tenant's own install is the tenant's storage; anything else, an unknown `from` included, is counted (never free).
  const source: StorageSource = found.from === 'own' && !isRootTenant(tenantId) ? 'tenant' : 'platform'
  return { provider: new IsolatedStorageProvider(found.invoke, cfg), resolvedName: found.key as StorageProviderType, source }
}
