import Logger from '@kuraykaraaslan-labs/logger'
import { providerCall } from './storage.errors'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { UploadFileDTO, UploadFromUrlDTO, DeleteFileDTO, GetFileUrlDTO } from './storage.dto'
import { UploadResult } from './storage.types'
import { STORAGE_MESSAGES } from './storage.messages'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { UploadedFile } from './entities/uploaded_file.entity'
import { IsNull } from 'typeorm'
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service'
import { declaredUploadTooLarge, validateUpload } from './storage.validation'
import { presignS3GetUrl } from './storage.sigv4'
import { getMaxUploadBytes, getProvider, getStorageSettings, getValidationPolicy } from './storage.provider-factory'
import { scopeOfSource } from './storage.source'
import { persistUploadAudit, assertStorageFeatureAccess } from './storage.audit'
import { getScanConfig } from './storage.scanner-factory'
import { scan } from './storage.scan.service'
import { enqueueVirusScan } from './storage.scan.job'
import type { VirusScanStatus } from './storage.scan.enums'
import { storageFetch } from './storage.safe-fetch'

/**
 * Every key-addressed operation (URL, presign, delete, hard delete) refuses a key outside the tenant's own prefix
 * (F.storage.01). The bucket is shared by every tenant that inherits the platform storage configuration, and callers (the plugin
 * broker, drive, telephony, documents) pass keys along: a key of another tenant, a `../` walk or a key with no tenant prefix was
 * a cross-tenant read or delete. Checked before the provider is asked anything.
 */
export function assertTenantObjectKey(tenantId: string, key: unknown): asserts key is string {
  const ok = typeof key === 'string'
    && key.length > 0 && key.length <= 1024
    && key.startsWith(`${tenantId}/`)
    && !key.includes('\\') && !key.includes('\0')
    && !key.split('/').slice(1).some((seg) => seg === '' || seg === '.' || seg === '..')
  if (!ok) throw new AppError(STORAGE_MESSAGES.KEY_OUTSIDE_TENANT, 403, ErrorCode.FORBIDDEN)
}

/**
 * Phase 53.5: the side an object was stored on (its row's `source`), so it is read and deleted there even after the storage
 * module's setting level changed. Null for an object stored before sources were recorded, or without a row: such an object
 * follows the provider in force, as it always did.
 */
async function objectSource(tenantId: string, key: string, withDeleted = false): Promise<'platform' | 'tenant' | null> {
  try {
    const row = await withTenantRepositoryFor(tenantId, UploadedFile, (repo) => repo.findOne({ where: { tenantId, key }, withDeleted }))
    return row?.source ?? null
  } catch {
    return null
  }
}

/** The provider of an object: on the side it was stored on when that is known, else the one in force. */
async function providerOfObject(tenantId: string, key: string, requested: DeleteFileDTO['provider'], withDeleted = false) {
  const source = await objectSource(tenantId, key, withDeleted)
  return source ? getProvider(tenantId, requested, { source }) : getProvider(tenantId, requested)
}

/** The storage settings of an object's side (see providerOfObject). */
async function settingsOfObject(tenantId: string, key: string) {
  const scope = scopeOfSource(tenantId, await objectSource(tenantId, key))
  return scope ? getStorageSettings(tenantId, scope) : getStorageSettings(tenantId)
}

/** Upload a file to storage for a tenant. */
export async function uploadFile(tenantId: string, data: UploadFileDTO): Promise<UploadResult> {
  await assertStorageFeatureAccess(tenantId)

  const { file: rawFile, folder, filename, provider: requestedProvider, userId, origin } = data

  try {
    // Validate content (size, extension, magic bytes) and strip EXIF before
    // anything is written to the bucket. `mimeType` is content-derived, not the
    // client's spoofable header.
    const policy = await getValidationPolicy(tenantId, { folder })
    const { file, mimeType } = await validateUpload(rawFile, policy)

    const scanCfg = await getScanConfig(tenantId)
    let scanStatus: VirusScanStatus = scanCfg.enabled ? 'pending' : 'skipped'

    // Synchronous mode: scan BEFORE the bytes reach the bucket so an infected
    // file is never stored or served.
    if (scanCfg.enabled && scanCfg.mode === 'sync') {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const res = await scan(scanCfg, bytes, file.name, { tenantId, userId: userId ?? null, mode: 'sync', key: folder ?? null })
      if (res.status === 'infected') {
        throw new AppError(STORAGE_MESSAGES.SCAN_INFECTED, 422, ErrorCode.VALIDATION_ERROR)
      }
      scanStatus = res.status // 'clean' | 'error'
    }

    const { provider, resolvedName, source } = await getProvider(tenantId, requestedProvider)
    const result = await providerCall('uploadFile', () => provider.uploadFile(file, { folder, filename, tenantId }))

    const uploadResult: UploadResult = { ...result, provider: resolvedName, source }
    const uploadedFileId = await persistUploadAudit(tenantId, userId, uploadResult, mimeType, scanStatus, origin)

    // Asynchronous mode: object is stored as 'pending'; scan in the background.
    if (scanCfg.enabled && scanCfg.mode === 'async' && uploadedFileId) {
      await enqueueVirusScan(uploadedFileId, result.key, tenantId).catch((e) =>
        Logger.warn(`enqueue virus scan failed: ${e instanceof Error ? e.message : String(e)}`),
      )
    }

    return { ...uploadResult, uploadedFileId }
  } catch (error) {
    Logger.error(`${STORAGE_MESSAGES.UPLOAD_FAILED}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

/**
 * Refuse an upload request with 413 when its declared Content-Length is already
 * over the tenant's effective cap. The upload routes call it BEFORE
 * `request.formData()`, which would otherwise read the whole body into memory
 * only for `validateUpload` to reject it afterwards. Without the header there is
 * nothing to judge yet (and no settings read): the size check after parsing
 * still applies.
 */
export async function assertDeclaredUploadSize(tenantId: string, contentLength: string | null): Promise<void> {
  if (!contentLength) return
  const maxBytes = await getMaxUploadBytes(tenantId)
  if (declaredUploadTooLarge(contentLength, maxBytes)) {
    throw new AppError(STORAGE_MESSAGES.FILE_TOO_LARGE, 413, ErrorCode.VALIDATION_ERROR, { details: { maxBytes } })
  }
}

/** Upload a file from URL to storage for a tenant. */
export async function uploadFromUrl(tenantId: string, data: UploadFromUrlDTO): Promise<UploadResult> {
  await assertStorageFeatureAccess(tenantId)

  const { url, folder, filename, provider: requestedProvider, userId, origin } = data

  try {
    const { provider, resolvedName, source } = await getProvider(tenantId, requestedProvider)
    const result = await providerCall('uploadFromUrl', () => provider.uploadFromUrl(url, { url, folder, filename, tenantId }))

    // URL uploads have no in-memory buffer at this layer, so scanning is always
    // performed asynchronously (the sync-mode setting does not apply here).
    const scanCfg = await getScanConfig(tenantId)
    const scanStatus: VirusScanStatus = scanCfg.enabled ? 'pending' : 'skipped'

    const uploadResult: UploadResult = { ...result, provider: resolvedName, source }
    const uploadedFileId = await persistUploadAudit(
      tenantId, userId, uploadResult, 'application/octet-stream', scanStatus, origin,
    )

    if (scanCfg.enabled && uploadedFileId) {
      await enqueueVirusScan(uploadedFileId, result.key, tenantId).catch((e) =>
        Logger.warn(`enqueue virus scan failed: ${e instanceof Error ? e.message : String(e)}`),
      )
    }

    return { ...uploadResult, uploadedFileId }
  } catch (error) {
    Logger.error(`${STORAGE_MESSAGES.UPLOAD_FAILED}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

/**
 * Delete a file from a tenant's storage.
 * Soft-deletes the matching UploadedFile audit row so we keep an immutable
 * record of what existed.
 */
export async function deleteFile(tenantId: string, data: DeleteFileDTO): Promise<void> {
  const { key, provider: requestedProvider } = data
  assertTenantObjectKey(tenantId, key)

  try {
    const { provider } = await providerOfObject(tenantId, key, requestedProvider)
    await providerCall('deleteFile', () => provider.deleteFile(key))

    try {
      const row = await withTenantRepositoryFor(tenantId, UploadedFile, async (repo) => {
        const found = await repo.findOne({ where: { tenantId, key, deletedAt: IsNull() } })
        if (found) await repo.softRemove(found)
        return found
      })
      // Phase 53.5: an object on the tenant's own storage was never counted against the plan.
      if (row?.size && row.size > 0 && row.source !== 'tenant') {
        await TenantUsageService.decrementStorageBytes(tenantId, row.size)
      }
    } catch (auditError) {
      Logger.warn(
        `StorageService.deleteFile audit soft-delete failed: ${
          auditError instanceof Error ? auditError.message : String(auditError)
        }`,
      )
    }
  } catch (error) {
    Logger.error(`${STORAGE_MESSAGES.DELETE_FAILED}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

/** Get file URL from a tenant's storage. */
export async function getFileUrl(tenantId: string, data: GetFileUrlDTO): Promise<string> {
  const { key, provider: requestedProvider } = data
  assertTenantObjectKey(tenantId, key)

  try {
    const { provider } = await providerOfObject(tenantId, key, requestedProvider)
    return providerCall('getFileUrl', () => Promise.resolve(provider.getFileUrl(key)))
  } catch (error) {
    Logger.error(`Failed to get file URL: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

/** Options of a presigned GET. */
export interface PresignGetOptions {
  /**
   * A `Content-Disposition` the store answers with (`attachment; filename*=…` for a download under the file's name).
   * The local provider has no signing surface and ignores it.
   */
  contentDisposition?: string
}

/**
 * Generate a real, time-limited presigned GET URL (SigV4) for a private
 * object. `expiresSeconds` defaults to 15 minutes.
 */
export async function getPresignedUrl(tenantId: string, key: string, expiresSeconds = 900, opts: PresignGetOptions = {}): Promise<string> {
  assertTenantObjectKey(tenantId, key)
  const { providerName, config } = await settingsOfObject(tenantId, key)
  // The local disk has no SigV4 surface: its provider signs an app URL of its own (a browser fetches it from this app). A plugin
  // that still answers to the key `local` with a file:// endpoint is asked for its object URL as before.
  if (providerName === 'local') {
    const { provider } = await getProvider(tenantId, 'local')
    return providerCall('getFileUrl', () => Promise.resolve(provider.getReadUrl ? provider.getReadUrl(key, expiresSeconds) : provider.getFileUrl(key)))
  }
  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new AppError(STORAGE_MESSAGES.PROVIDER_NOT_CONFIGURED, 422, ErrorCode.VALIDATION_ERROR)
  }
  return opts.contentDisposition
    ? presignS3GetUrl(config, key, expiresSeconds, { contentDisposition: opts.contentDisposition })
    : presignS3GetUrl(config, key, expiresSeconds)
}

/**
 * A URL the SERVER reads an object from (never for a browser): what `getPresignedUrl` answers for a bucket provider, and for the
 * local disk a `file://` URL of the object's real path (Node's `fetch` cannot read it, so the readers below, the plugin bundle
 * loader and the download links open the path directly). A missing object, or a link that leaves the base directory, is a 404.
 */
export async function getServerReadUrl(tenantId: string, key: string, expiresSeconds = 120): Promise<string> {
  assertTenantObjectKey(tenantId, key)
  const { providerName } = await settingsOfObject(tenantId, key)
  if (providerName !== 'local') return getPresignedUrl(tenantId, key, expiresSeconds)
  const { provider } = await getProvider(tenantId, 'local')
  if (!provider.getServerPath) return providerCall('getFileUrl', () => Promise.resolve(provider.getFileUrl(key)))
  const real = await provider.getServerPath(key)
  if (!real) throw new AppError('Object not found', 404, ErrorCode.NOT_FOUND)
  const { pathToFileURL } = await import('node:url')
  return pathToFileURL(real).href
}

/**
 * Read an object's bytes back into the server process — for anything that has
 * to re-process an upload afterwards (e.g. telephony transcribing a stored
 * voicemail) rather than just handing a link to a browser.
 *
 * Mirrors `marketplace/server/plugin-resolve.ts`'s bundle loader, which hit
 * the same fork first: local storage's "presigned" URL is a `file://` URL
 * (no signing surface to speak of), which Node's `fetch` cannot read, so it
 * is read from disk directly; everything else is a normal HTTP GET.
 *
 * `maxBytes` reads at most that many bytes from the start (a `Range` request, and the body is cut there even when the
 * store answers the whole object): a preview of a large text file must not pull it whole (drive, 41-ui-fixes/10 3.6).
 * An empty object read that way is an empty buffer, not the store's 416.
 */
export async function downloadBuffer(tenantId: string, key: string, opts: { maxBytes?: number } = {}): Promise<Buffer> {
  const max = opts.maxBytes != null && Number.isFinite(opts.maxBytes) && opts.maxBytes > 0 ? Math.floor(opts.maxBytes) : null
  const url = await getServerReadUrl(tenantId, key, 120)
  if (url.startsWith('file://')) {
    const [{ readFile, open }, { fileURLToPath }] = await Promise.all([import('node:fs/promises'), import('node:url')])
    if (max == null) return readFile(fileURLToPath(url))
    const handle = await open(fileURLToPath(url), 'r')
    try {
      const buf = Buffer.alloc(max)
      const { bytesRead } = await handle.read(buf, 0, max, 0)
      return buf.subarray(0, bytesRead)
    } finally {
      await handle.close()
    }
  }
  const res = await storageFetch(url, max == null ? {} : { headers: { Range: `bytes=0-${max - 1}` } }) // storage.08
  // A range from byte 0 is unsatisfiable only for an empty object: S3 / R2 / MinIO answer 416 there, which is no
  // failure but zero bytes (41-ui-fixes/10 3.6).
  if (max != null && res.status === 416) {
    await res.body?.cancel().catch(() => {})
    return Buffer.alloc(0)
  }
  if (!res.ok) throw new AppError(`Failed to download file (${res.status})`, 502, ErrorCode.INTERNAL_ERROR)
  if (max == null) return Buffer.from(await res.arrayBuffer())
  return readAtMost(res, max)
}

/** The first `max` bytes of a response body; the rest is not read (the stream is cancelled). */
async function readAtMost(res: Response, max: number): Promise<Buffer> {
  const body = res.body
  if (!body) return Buffer.from(await res.arrayBuffer()).subarray(0, max)
  const reader = body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (total < max) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      total += value.length
    }
  } finally {
    if (total >= max) await reader.cancel().catch(() => {})
    else reader.releaseLock()
  }
  return Buffer.concat(chunks).subarray(0, max)
}

/**
 * Upload a server-generated buffer (e.g. a data export archive) directly to
 * the tenant's bucket, bypassing the image-oriented upload validation.
 */
export async function uploadServerBuffer(
  tenantId: string,
  data: { buffer: Buffer; filename: string; contentType?: string; folder?: string; scan?: boolean; trusted?: boolean },
): Promise<UploadResult> {
  // Opt-in virus scanning (marketplace roadmap §6C). Server-generated content
  // (invoices, exports) needs no scan — but a THIRD-PARTY payload routed
  // through this path (a plugin bundle) does, with the same semantics as
  // uploadFile: sync mode refuses an infected file before it ever reaches the
  // bucket; async mode stores it 'pending' and lets the background scan decide.
  // The scan logic stays HERE, in its one owner — callers only ask for it.
  // `trusted`: the bytes are not a browser upload (a plugin bundle the platform checked itself: manifest, size, checksum, signature and this scan),
  // so the image-oriented extension and MIME allowlists do not apply. The folder must still be a registered one.
  const contentType = data.contentType ?? 'application/octet-stream'
  let scanStatus: VirusScanStatus = 'skipped'
  let scanCfg: Awaited<ReturnType<typeof getScanConfig>> | null = null
  if (data.scan) {
    scanCfg = await getScanConfig(tenantId)
    scanStatus = scanCfg.enabled ? 'pending' : 'skipped'
    if (scanCfg.enabled && scanCfg.mode === 'sync') {
      const res = await scan(scanCfg, new Uint8Array(data.buffer), data.filename, { tenantId, mode: 'sync', key: data.folder ?? null })
      if (res.status === 'infected') {
        throw new AppError(STORAGE_MESSAGES.SCAN_INFECTED, 422, ErrorCode.VALIDATION_ERROR)
      }
      scanStatus = res.status // 'clean' | 'error'
    }
  }

  const { provider, resolvedName, source } = await getProvider(tenantId)
  const file = new File([new Uint8Array(data.buffer)], data.filename, { type: contentType })
  const result = await providerCall('uploadFile', () => provider.uploadFile(file, { folder: data.folder, filename: data.filename, tenantId, ...(data.trusted ? { trusted: true } : {}) }))
  const uploadResult: UploadResult = { ...result, provider: resolvedName, source }
  // The audit row's id is RETURNED, unlike before. Both other upload paths hand
  // it back and callers store it as the file's durable identity; this one
  // dropped it on the floor, so a server-generated object could only ever be
  // referenced by its key — and a key is a location, not an identity.
  const uploadedFileId = await persistUploadAudit(
    tenantId, undefined, uploadResult, contentType, scanStatus,
  )
  if (scanCfg?.enabled && scanCfg.mode === 'async' && uploadedFileId) {
    await enqueueVirusScan(uploadedFileId, result.key, tenantId).catch((e) =>
      Logger.warn(`enqueue virus scan failed: ${e instanceof Error ? e.message : String(e)}`),
    )
  }
  return { ...uploadResult, uploadedFileId }
}

/** A filename of a static object: one flat segment, so the key stays `<tenant>/<folder>/<filename>` and nothing can climb out of the folder. */
const STATIC_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/

/**
 * Write a server-generated object to a STABLE key and leave it there, overwritten in place on every call (`<tenant>/<folder>/<filename>`).
 *
 * This is not `uploadServerBuffer`. A static object that is republished on a heartbeat (the status page snapshot) must not
 *  - leave an `UploadedFile` audit row per publish (a row every few minutes, forever) or
 *  - add its size to the tenant's storage counter on every publish (an overwrite is not new storage),
 * and it is not a user upload, so the image-oriented extension and MIME allowlists do not apply (`trusted`). The folder must still be a
 * registered one, and the filename a single plain segment. The caller is server code that built the bytes itself; nothing from a browser
 * reaches it.
 */
export async function putStaticObject(
  tenantId: string,
  data: { buffer: Buffer; filename: string; contentType: string; folder: string },
): Promise<{ key: string; url: string; bucket: string; size: number | undefined }> {
  if (!STATIC_FILENAME.test(data.filename)) throw new AppError('Invalid object name', 400, ErrorCode.VALIDATION_ERROR)
  const { provider } = await getProvider(tenantId)
  const file = new File([new Uint8Array(data.buffer)], data.filename, { type: data.contentType })
  const result = await providerCall('uploadFile', () => provider.uploadFile(file, { folder: data.folder, filename: data.filename, tenantId, contentType: data.contentType, trusted: true }))
  return { key: result.key, url: result.url, bucket: result.bucket, size: result.size }
}

/**
 * GDPR / KVKK hard delete: permanently remove the object from the bucket AND
 * the audit row (not a soft-delete), decrementing the tenant byte counter.
 */
export async function hardDeleteFile(tenantId: string, data: DeleteFileDTO): Promise<void> {
  const { key, provider: requestedProvider } = data
  assertTenantObjectKey(tenantId, key)
  const { provider } = await providerOfObject(tenantId, key, requestedProvider, true)
  await providerCall('deleteFile', () => provider.deleteFile(key))

  try {
    const result = await withTenantRepositoryFor(tenantId, UploadedFile, async (repo) => {
      // withDeleted: also catch rows already soft-deleted.
      const found = await repo.findOne({ where: { tenantId, key }, withDeleted: true })
      if (!found) return null
      const wasActive = !found.deletedAt
      await repo.remove(found)
      return { wasActive, size: found.size, source: found.source }
    })
    // Phase 53.5: an object on the tenant's own storage was never counted against the plan.
    if (result?.wasActive && result.size && result.size > 0 && result.source !== 'tenant') {
      await TenantUsageService.decrementStorageBytes(tenantId, result.size)
    }
  } catch (auditError) {
    Logger.warn(`StorageService.hardDeleteFile audit purge failed: ${auditError instanceof Error ? auditError.message : String(auditError)}`)
  }
}
