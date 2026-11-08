import { randomBytes, randomUUID } from 'node:crypto'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import type { PresignUploadDTO, UploadOrigin } from './storage.dto'
import type { S3Config, UploadResult } from './storage.types'
import { STORAGE_MESSAGES } from './storage.messages'
import { presignS3PutUrl, presignS3Url } from './storage.sigv4'
import { getProvider, getStorageSettings, getValidationPolicy } from './storage.provider-factory'
import { providerUploadRejection } from './providers/isolated.provider'
import {
  MAX_UPLOAD_FILE_BYTES, assertDeclaredSize, contentMatchesExtension, stripJpegMetadata, validateDeclaredName,
} from './storage.validation'
import { assertStorageFeatureAccess, persistUploadAudit } from './storage.audit'
import { getScanConfig } from './storage.scanner-factory'
import { enqueueVirusScan } from './storage.scan.job'
import type { VirusScanStatus } from './storage.scan.enums'
import {
  STAGING_FOLDER, STAGING_SWEEP_GRACE_MS, claimCompletion, consumeSession, dueStagingObjects, forgetStagingObject,
  hashUploadId, readCompleted, readSession, releaseCompletion, saveCompleted, saveSession, scheduleStagingDelete,
  type CompletedUpload, type DirectUploadSession,
} from './storage.direct-upload.store'
import { storageFetch } from './storage.safe-fetch'

/**
 * Browser-direct uploads: presign -> the browser PUTs the file to the bucket ->
 * complete. The bytes never cross the app, so the 10 MiB request ceiling of the
 * multipart route (`UPLOAD_REQUEST_CEILING_BYTES`) does not apply and the
 * tenant's real `maxFileSizeMb` does (up to `DIRECT_UPLOAD_MAX_BYTES`).
 *
 * - presign checks the declaration (name, size, folder) against the same rules
 *   the multipart path applies to a received file, reserves server-generated
 *   staging and final keys under the tenant's prefix, and signs a short-lived
 *   PUT bound to the declared Content-Type and Content-Length.
 * - complete reads the staged object back (HEAD for size, type and ETag, the
 *   leading bytes for the magic-byte check), copies exactly those bytes to the
 *   final key and records the file as `uploadFile` does (audit row, usage,
 *   async virus scan). It is single-use and idempotent: a retry returns the
 *   first answer, a second upload is never recorded.
 *
 * The URLs are signed host-side with the tenant's storage settings, the signer
 * `getPresignedUrl`, the scan job and download links already use. A provider
 * whose resolved bucket is not the one those settings sign for, the local
 * provider, a plain-HTTP endpoint (the CSP and mixed-content rules block it from
 * a page anyway), and a tenant scanning synchronously answer `mode: 'multipart'`
 * and the client falls back to the existing upload route.
 */

/** The presigned PUT must be STARTED within this window (stores check expiry when the request arrives). */
export const PRESIGN_URL_TTL_SECONDS = 15 * 60
/** How long an upload may take between presign and complete. */
export const UPLOAD_SESSION_TTL_SECONDS = 4 * 3600
/** Validity of the server's own signed requests (HEAD, ranged GET, copy, delete). */
const SERVER_REQUEST_TTL_SECONDS = 60
/** Bytes the magic-byte check reads. */
const HEAD_BYTES = 16

/**
 * EXIF stripping of direct uploads. The multipart path strips JPEG metadata from
 * the buffer before storing it, and a JPEG that fits that path (up to
 * `MAX_UPLOAD_FILE_BYTES`) keeps using it, so nothing changes for photos of the
 * size users uploaded until now. A larger JPEG goes direct and complete strips
 * it while writing the final object: it downloads the staged bytes (bounded by
 * this cap), strips them and PUTs the result to the final key. A JPEG above the
 * cap is refused while stripping is on, rather than stored with its location
 * and device data; a tenant that turns `imageStripExif` off is not limited by it.
 */
export const EXIF_REWRITE_MAX_BYTES = 32 * 1024 * 1024

/** Why an upload has to use the multipart route. */
export type MultipartReason =
  | 'local_provider' | 'no_signing_credentials' | 'provider_mismatch' | 'insecure_endpoint' | 'sync_scan' | 'exif_strip'

export type PresignUploadResult =
  | { mode: 'multipart'; reason: MultipartReason; maxBytes: number }
  | {
    mode: 'direct'
    uploadId: string
    method: 'PUT'
    url: string
    /** Send exactly these headers with the PUT (they are signed). */
    headers: Record<string, string>
    expiresAt: string
    maxBytes: number
    /** Largest file the client may still send through the multipart route if the PUT cannot reach the bucket. */
    multipartMaxBytes: number
  }

export interface PresignUploadContext {
  userId?: string
  origin?: UploadOrigin
  /** Which complete route may finish the upload. */
  purpose: string
  /** Consumer data stored with the session and handed back by complete; never taken from the complete request. */
  meta?: Record<string, string | null>
}

export interface CompleteUploadContext {
  userId?: string
  purpose: string
  /** Runs after the session is claimed and before anything is verified or written; a throw aborts the complete. */
  authorize?: (session: DirectUploadSession) => Promise<void>
  /** Runs after the file is recorded; its result is cached and replayed with the upload. */
  finalize?: (upload: CompletedUpload, session: DirectUploadSession) => Promise<unknown>
}

export interface CompleteUploadResult {
  upload: CompletedUpload
  extra?: unknown
  /** True when this call returned the answer of an earlier complete. */
  replayed: boolean
}

const normalizeEndpoint = (e: string) => e.trim().replace(/\/+$/, '').toLowerCase()

/** True for an https endpoint; false for plain HTTP and for a value that is not a URL at all. */
function isHttpsEndpoint(endpoint: string): boolean {
  try {
    return new URL(endpoint).protocol === 'https:'
  } catch {
    return false
  }
}

type DirectTarget =
  | { reason: MultipartReason }
  | { reason: null; config: S3Config; resolvedName: DirectUploadSession['provider']; source: DirectUploadSession['source']; fileUrl: (key: string) => string }

/**
 * Can this tenant's uploads go straight to the bucket? Only when the host can
 * sign for the very bucket the resolved provider writes to: the final object
 * must sit where the provider builds URLs, deletes and quarantines.
 */
async function resolveDirectTarget(tenantId: string, requested?: PresignUploadDTO['provider']): Promise<DirectTarget> {
  const { provider, resolvedName, source } = await getProvider(tenantId, requested)
  const { providerName, config } = await getStorageSettings(tenantId)
  if (resolvedName === 'local' || providerName === 'local') return { reason: 'local_provider' }
  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) return { reason: 'no_signing_credentials' }
  if (config.endpoint && !isHttpsEndpoint(config.endpoint)) return { reason: 'insecure_endpoint' }
  const target = provider.describeTarget()
  const endpointsDiffer = !!target.endpoint && !!config.endpoint && normalizeEndpoint(target.endpoint) !== normalizeEndpoint(config.endpoint)
  if (target.bucket !== config.bucket || endpointsDiffer) return { reason: 'provider_mismatch' }
  return { reason: null, config, resolvedName, source, fileUrl: (key) => provider.getFileUrl(key) }
}

/** The final key, shaped like the ones `IsolatedStorageProvider` generates. */
function finalKeyFor(tenantId: string, folder: string, name: string, ext: string): string {
  const base = (name.slice(0, name.length - ext.length - 1) || 'file').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'file'
  return `${tenantId}/${folder}/${Date.now()}-${randomUUID().slice(0, 8)}-${base}.${ext}`
}

/** Step 1: check the declaration and answer how the client should upload. */
export async function presignUpload(tenantId: string, input: PresignUploadDTO, ctx: PresignUploadContext): Promise<PresignUploadResult> {
  await assertStorageFeatureAccess(tenantId)

  const folder = input.folder || 'general'
  const policy = await getValidationPolicy(tenantId, { direct: true, folder })
  const { ext, mimeType } = validateDeclaredName(input.name, policy)
  switch (providerUploadRejection(input.name, mimeType, folder)) {
    case 'folder': throw new AppError(STORAGE_MESSAGES.INVALID_FOLDER, 422, ErrorCode.VALIDATION_ERROR)
    case 'extension': throw new AppError(STORAGE_MESSAGES.INVALID_EXTENSION, 422, ErrorCode.VALIDATION_ERROR)
    case 'mime': throw new AppError(STORAGE_MESSAGES.INVALID_MIME_TYPE, 422, ErrorCode.VALIDATION_ERROR)
  }

  // The multipart route's cap: the tenant setting clamped to the request ceiling.
  const multipartMaxBytes = Math.min(policy.maxBytes, MAX_UPLOAD_FILE_BYTES)
  const stripExif = policy.stripExif && (ext === 'jpg' || ext === 'jpeg')

  const multipart = (reason: MultipartReason): PresignUploadResult => {
    assertDeclaredSize(input.size, multipartMaxBytes)
    return { mode: 'multipart', reason, maxBytes: multipartMaxBytes }
  }
  const target = await resolveDirectTarget(tenantId, input.provider)
  if (target.reason !== null) return multipart(target.reason)
  const scanCfg = await getScanConfig(tenantId)
  // Sync mode promises that an infected file is never stored; a direct PUT
  // stores before anything can scan, so such a tenant keeps the old path.
  if (scanCfg.enabled && scanCfg.mode === 'sync') return multipart('sync_scan')
  if (stripExif && input.size <= MAX_UPLOAD_FILE_BYTES) return multipart('exif_strip')

  const maxBytes = stripExif ? Math.min(policy.maxBytes, EXIF_REWRITE_MAX_BYTES) : policy.maxBytes
  assertDeclaredSize(input.size, maxBytes)

  const now = Date.now()
  const uploadId = randomBytes(32).toString('base64url')
  const key = finalKeyFor(tenantId, folder, input.name, ext)
  const session: DirectUploadSession = {
    tenantId,
    userId: ctx.userId,
    purpose: ctx.purpose,
    meta: ctx.meta ?? {},
    name: input.name,
    size: input.size,
    mimeType,
    folder,
    stagingKey: `${tenantId}/${STAGING_FOLDER}/${randomUUID()}`,
    key,
    bucket: target.config.bucket,
    provider: target.resolvedName,
    source: target.source,
    url: target.fileUrl(key),
    maxBytes,
    stripExif,
    origin: ctx.origin,
    createdAt: now,
    urlExpiresAt: now + PRESIGN_URL_TTL_SECONDS * 1000,
    expiresAt: now + UPLOAD_SESSION_TTL_SECONDS * 1000,
  }
  await saveSession(hashUploadId(uploadId), session, UPLOAD_SESSION_TTL_SECONDS)

  return {
    mode: 'direct',
    uploadId,
    method: 'PUT',
    url: presignS3PutUrl(target.config, session.stagingKey, {
      contentType: mimeType, contentLength: input.size, expiresSeconds: PRESIGN_URL_TTL_SECONDS,
    }),
    headers: { 'Content-Type': mimeType },
    expiresAt: new Date(session.urlExpiresAt).toISOString(),
    maxBytes,
    multipartMaxBytes,
  }
}

const notFound = () => new AppError(STORAGE_MESSAGES.UPLOAD_SESSION_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
const unavailable = () => new AppError(STORAGE_MESSAGES.UPLOAD_STORAGE_UNAVAILABLE, 502, ErrorCode.INTERNAL_ERROR)

/** A request to the bucket; a network failure is a retryable 502. */
async function bucketFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await storageFetch(url, init) // storage.08
  } catch (error) {
    Logger.warn(`direct upload: storage request failed: ${error instanceof Error ? error.message : String(error)}`)
    throw unavailable()
  }
}

/**
 * Whether this host can sign requests for the very bucket the tenant's provider writes to (the condition a browser-direct upload needs). Then a
 * server-side PUT (`putSignedObject`) may carry an object the sandboxed provider cannot take through its base64 boundary.
 */
export async function canSignForTenantBucket(tenantId: string): Promise<boolean> {
  return (await resolveDirectTarget(tenantId)).reason === null
}

/**
 * PUTs `bytes` at exactly `key` in the tenant's bucket with a host-signed request, the bytes as the request body (no base64, no isolate). Only for server
 * code that already vouched for the key and the bytes (a migrated tenant's objects, `storage.migration.ts`). False, and nothing sent, when the host
 * cannot sign for the provider's bucket; a store that refuses the PUT throws a retryable 502.
 */
export async function putSignedObject(tenantId: string, key: string, bytes: Buffer, contentType: string): Promise<boolean> {
  const target = await resolveDirectTarget(tenantId)
  if (target.reason !== null) return false
  const res = await bucketFetch(
    presignS3PutUrl(target.config, key, { contentType, contentLength: bytes.length, expiresSeconds: SERVER_REQUEST_TTL_SECONDS }),
    { method: 'PUT', headers: { 'Content-Type': contentType }, body: bytes as unknown as BodyInit },
  )
  if (!res.ok) throw unavailable()
  return true
}

/** Read at most `n` leading bytes, also when the store ignores the Range header and sends the whole object. */
async function readLeading(res: Response, n: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).subarray(0, n)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let got = 0
  while (got < n) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
  }
  await reader.cancel().catch(() => undefined)
  return Buffer.concat(chunks).subarray(0, n)
}

class Rejected extends Error {
  constructor(readonly error: AppError) { super(error.message) }
}
const reject = (message: string, status: number, details?: Record<string, unknown>): never => {
  throw new Rejected(new AppError(message, status, ErrorCode.VALIDATION_ERROR, details ? { details } : undefined))
}

/**
 * Check the staged object and write the final one from exactly the bytes that
 * were checked. Throws `Rejected` when the upload must be discarded, an
 * AppError when it may be retried.
 */
async function verifyAndPlace(cfg: S3Config, s: DirectUploadSession): Promise<number> {
  const sign = (method: 'HEAD' | 'GET' | 'DELETE', key: string) => presignS3Url(cfg, method, key, { expiresSeconds: SERVER_REQUEST_TTL_SECONDS })

  const head = await bucketFetch(sign('HEAD', s.stagingKey), { method: 'HEAD' })
  if (head.status === 404) throw new AppError(STORAGE_MESSAGES.UPLOAD_OBJECT_MISSING, 409, ErrorCode.CONFLICT)
  if (!head.ok) throw unavailable()
  const size = Number(head.headers.get('content-length'))
  if (size !== s.size) reject(STORAGE_MESSAGES.UPLOAD_SIZE_MISMATCH, 422)
  if (size > s.maxBytes) reject(STORAGE_MESSAGES.FILE_TOO_LARGE, 413, { maxBytes: s.maxBytes })
  const type = (head.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
  if (type && type !== s.mimeType) reject(STORAGE_MESSAGES.INVALID_MIME_TYPE, 422)
  // Every later read and the copy are conditional on this ETag, so the bytes
  // that get recorded are the bytes that were checked.
  const etag = head.headers.get('etag')
  const ifMatch: Record<string, string> = etag ? { 'If-Match': etag } : {}

  const get = await bucketFetch(sign('GET', s.stagingKey), {
    headers: s.stripExif ? ifMatch : { ...ifMatch, Range: `bytes=0-${HEAD_BYTES - 1}` },
  })
  if (get.status === 412) reject(STORAGE_MESSAGES.UPLOAD_CHANGED, 409)
  if (!get.ok) throw unavailable()
  const bytes = s.stripExif ? new Uint8Array(await get.arrayBuffer()) : null
  const leading = bytes ? bytes.subarray(0, HEAD_BYTES) : await readLeading(get, HEAD_BYTES)
  if (bytes && bytes.length !== s.size) reject(STORAGE_MESSAGES.UPLOAD_CHANGED, 409)
  if (!contentMatchesExtension(s.name, leading)) reject(STORAGE_MESSAGES.MIME_MISMATCH, 422)

  if (bytes) {
    const stripped = stripJpegMetadata(bytes)
    const put = await bucketFetch(
      presignS3PutUrl(cfg, s.key, { contentType: s.mimeType, contentLength: stripped.length, expiresSeconds: SERVER_REQUEST_TTL_SECONDS }),
      { method: 'PUT', headers: { 'Content-Type': s.mimeType }, body: stripped as unknown as BodyInit },
    )
    if (!put.ok) throw unavailable()
    return stripped.length
  }

  const copyHeaders: Record<string, string> = {
    'x-amz-copy-source': `/${cfg.bucket}/${s.stagingKey.split('/').map(encodeURIComponent).join('/')}`,
    ...(etag ? { 'x-amz-copy-source-if-match': etag } : {}),
  }
  const copy = await bucketFetch(
    presignS3Url(cfg, 'PUT', s.key, { expiresSeconds: SERVER_REQUEST_TTL_SECONDS, headers: copyHeaders }),
    { method: 'PUT', headers: copyHeaders },
  )
  if (copy.status === 412) reject(STORAGE_MESSAGES.UPLOAD_CHANGED, 409)
  // S3 may report a copy failure inside a 200 body.
  if (!copy.ok || (await copy.text()).includes('<Error>')) throw unavailable()
  return size
}

/** Delete a staging object now (best-effort) and keep it scheduled until its PUT URL can no longer recreate it. */
async function retireStaging(cfg: S3Config, s: DirectUploadSession): Promise<void> {
  // Never fails the complete: the presign already indexed the staging key with
  // the session deadline, so whatever is missed here the sweep still deletes.
  await bucketFetch(presignS3Url(cfg, 'DELETE', s.stagingKey, { expiresSeconds: SERVER_REQUEST_TTL_SECONDS }), { method: 'DELETE' })
    .catch(() => undefined)
  await scheduleStagingDelete(s.bucket, s.stagingKey, s.urlExpiresAt + STAGING_SWEEP_GRACE_MS)
    .catch((e) => Logger.warn(`direct upload: staging reschedule failed: ${e instanceof Error ? e.message : String(e)}`))
}

/** Step 3: verify the staged object and record the file. */
export async function completeUpload(tenantId: string, uploadId: string, ctx: CompleteUploadContext): Promise<CompleteUploadResult> {
  const hash = hashUploadId(uploadId)
  const owns = (r: { tenantId: string; userId?: string; purpose: string }) =>
    r.tenantId === tenantId && r.purpose === ctx.purpose && (r.userId ?? null) === (ctx.userId ?? null)

  const done = await readCompleted(hash)
  if (done) {
    if (!owns(done)) throw notFound()
    return { upload: done.upload, extra: done.extra, replayed: true }
  }
  const session = await readSession(hash)
  if (!session || !owns(session) || session.expiresAt <= Date.now()) throw notFound()

  if (!(await claimCompletion(hash))) {
    const raced = await readCompleted(hash)
    if (raced && owns(raced)) return { upload: raced.upload, extra: raced.extra, replayed: true }
    throw new AppError(STORAGE_MESSAGES.UPLOAD_IN_PROGRESS, 409, ErrorCode.CONFLICT)
  }

  try {
    await ctx.authorize?.(session)

    const { config } = await getStorageSettings(tenantId)
    if (!config.accessKeyId || !config.secretAccessKey) throw unavailable()
    // The staged object is in the bucket the session was signed for.
    const cfg: S3Config = { ...config, bucket: session.bucket }

    let size: number
    try {
      size = await verifyAndPlace(cfg, session)
    } catch (error) {
      if (!(error instanceof Rejected)) throw error
      await consumeSession(hash)
      await retireStaging(cfg, session)
      throw error.error
    }
    await consumeSession(hash)
    await retireStaging(cfg, session)

    // Direct uploads only start for tenants scanning asynchronously or not at
    // all (sync mode keeps the multipart path). A tenant that switched to sync
    // mode after the presign gets an async scan: the row is 'pending', and
    // download links refuse a pending object until the scan passes.
    const scanCfg = await getScanConfig(tenantId)
    const scanStatus: VirusScanStatus = scanCfg.enabled ? 'pending' : 'skipped'
    const result: UploadResult = { url: session.url, key: session.key, bucket: session.bucket, size, provider: session.provider, source: session.source }
    const uploadedFileId = await persistUploadAudit(tenantId, session.userId, result, session.mimeType, scanStatus, session.origin)
    if (scanCfg.enabled && uploadedFileId) {
      await enqueueVirusScan(uploadedFileId, session.key, tenantId).catch((e) =>
        Logger.warn(`enqueue virus scan failed: ${e instanceof Error ? e.message : String(e)}`),
      )
    }

    const upload: CompletedUpload = { ...result, uploadedFileId, mimeType: session.mimeType, name: session.name, meta: session.meta }
    const extra = ctx.finalize ? await ctx.finalize(upload, session) : undefined
    await saveCompleted(hash, { tenantId, userId: session.userId, purpose: session.purpose, upload, extra }, Math.ceil((session.expiresAt - Date.now()) / 1000))
    return { upload, extra, replayed: false }
  } catch (error) {
    Logger.error(`${STORAGE_MESSAGES.UPLOAD_FAILED}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  } finally {
    await releaseCompletion(hash)
  }
}

/**
 * Delete staging objects whose deadline has passed: presigns that were never
 * completed, and staging keys a client re-PUT after complete. Final keys are
 * never in the index, so the sweep cannot touch a recorded file. An entry whose
 * delete fails stays for the next run.
 */
export async function sweepStagingUploads(now = Date.now(), limit = 500): Promise<{ deleted: number; failed: number }> {
  let deleted = 0
  let failed = 0
  for (const { member, bucket, key } of await dueStagingObjects(now, limit)) {
    try {
      const tenantId = key.split('/')[0]
      if (bucket && tenantId && key.split('/')[1] === STAGING_FOLDER) {
        const { config } = await getStorageSettings(tenantId)
        if (config.accessKeyId && config.secretAccessKey) {
          const res = await storageFetch(presignS3Url({ ...config, bucket }, 'DELETE', key, { expiresSeconds: SERVER_REQUEST_TTL_SECONDS }), { method: 'DELETE' })
          if (!res.ok && res.status !== 404) throw new Error(`DELETE answered ${res.status}`)
        } else {
          Logger.warn(`direct upload sweep: no storage credentials left for ${tenantId}, forgetting ${key}`)
        }
      }
      await forgetStagingObject(member)
      deleted++
    } catch (error) {
      failed++
      Logger.warn(`direct upload sweep: ${member}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return { deleted, failed }
}
