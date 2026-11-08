import { v4 as uuidv4 } from 'uuid'
import BaseStorageProvider from './base.provider'
import { safeFetch } from '@kuraykaraaslan-labs/common/server/safe-fetch';
import type { UploadOptions, UploadFromUrlOptions, ProviderUploadResult, S3Config } from '../storage.types'
import { StorageExtensionSchema, StorageMimeTypeSchema } from '../storage.enums'
import { isValidStorageFolder } from '../storage.folders'
import { MAX_UPLOAD_FILE_BYTES } from '../storage.validation'
import { STORAGE_MESSAGES } from '../storage.messages'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'

/** storage.05: a client mistake (folder, extension, type) is a 4xx AppError, never a plain Error the route turns into a 500. */
const badFolder = () => new AppError('INVALID_FOLDER_NAME', 422, ErrorCode.VALIDATION_ERROR)
const badType = (message: string) => new AppError(message, 415, ErrorCode.VALIDATION_ERROR)

/**
 * 38-security 4.7: the object key for a caller-supplied filename. It was composed verbatim (`<tenant>/<folder>/<filename>`), so a name with
 * `../` or a leading slash climbed out of the folder (path traversal; on the local provider a zip-slip-equivalent). The filename must now be
 * ONE plain segment: no separators, no `..`, no NUL or control characters, a sane length. Other odd characters become `-`, like the generated
 * keys. The final key is asserted to stay under `<tenant>/<folder>/`.
 */
export function explicitObjectKey(tenantId: string, folder: string, filename: string): string {
  const bad = () => new AppError('Invalid object name', 400, ErrorCode.VALIDATION_ERROR)
  if (typeof filename !== 'string' || filename.length === 0 || filename.length > 200) throw bad()
  // eslint-disable-next-line no-control-regex
  if (/[\/\\\x00-\x1f\x7f]/.test(filename) || filename.split('.').every((p) => p === '') || filename.includes('..')) throw bad()
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!safe || safe === '.' || safe.startsWith('.')) throw bad()
  const key = `${tenantId}/${folder}/${safe}`
  if (!key.startsWith(`${tenantId}/${folder}/`) || key.slice(`${tenantId}/${folder}/`.length).includes('/')) throw bad()
  return key
}

/**
 * 38-security 4.6: the Content-Type an object is stored with. A browser renders html, svg and xml as active content from whatever origin
 * serves them, and a public bucket URL (or the app origin through a CDN) would run a scripted SVG. Those types are stored as an opaque
 * download, so they can never execute inline; app-served links already force `attachment` (storage.links.serve.ts). Folders that
 * enable svg get a download until a sanitising step exists. Server-generated (`trusted`) objects, like the public status page's html, keep the
 * type their server code declared: no browser upload reaches that path.
 */
export function storedContentType(filename: string, declared: string | undefined): string | undefined {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['html', 'htm', 'xhtml', 'svg', 'xml'].includes(ext) || /^(text\/html|image\/svg\+xml|application\/(xhtml\+)?xml|text\/xml)\b/i.test(declared ?? '')) {
    return 'application/octet-stream'
  }
  return declared
}

type Invoke = (op: string, input: unknown) => Promise<unknown>

/** Non-secret storage config resolved from the plugin (via the getConfig op). */
export interface ResolvedStorageConfig {
  bucket: string
  region: string
  endpoint?: string
}

/**
 * The provider-level rules every stored file passes (folder registry, extension
 * and MIME allowlists), or which one it breaks. `uploadFile` enforces them; a
 * browser-direct upload, which never goes through `uploadFile`, checks the same
 * rules on its declaration so both paths accept exactly the same files.
 */
export function providerUploadRejection(filename: string, mimeType: string, folder: string): 'folder' | 'extension' | 'mime' | null {
  if (!isValidStorageFolder(folder)) return 'folder'
  const extension = filename.split('.').pop()?.toLowerCase()
  if (!extension || !StorageExtensionSchema.safeParse(extension).success) return 'extension'
  if (!mimeType || !StorageMimeTypeSchema.safeParse(mimeType).success) return 'mime'
  return null
}

/**
 * Host-facing facade that runs a storage backend as a SANDBOXED community plugin.
 * File validation, key generation, the synchronous `getFileUrl`, and the
 * `uploadFromUrl` source fetch all run HOST-SIDE (the isolate can't do a sync URL
 * build, and an arbitrary source host can't be allowlisted). Only the SigV4-signed
 * PutObject/DeleteObject egress runs in the isolate; the secret access key stays
 * host-side (used in the SigV4 HMAC chain). File bytes cross the boundary as base64
 * (bounded by the isolate memory limit).
 */
export class IsolatedStorageProvider extends BaseStorageProvider {
  private readonly invoke: Invoke
  private readonly cfg: ResolvedStorageConfig

  constructor(invoke: Invoke, cfg: ResolvedStorageConfig) {
    super({ bucket: cfg.bucket, region: cfg.region, accessKeyId: '(sandboxed)', secretAccessKey: '(sandboxed)', endpoint: cfg.endpoint } as S3Config)
    this.invoke = invoke
    this.cfg = cfg
  }

  private validateFile(file: File, folder: string, trusted = false) {
    if (!file) throw new Error('No file provided')
    // Trusted (server-generated) content keeps the folder rule and skips the image allowlists; see `UploadOptions.trusted`.
    if (trusted) {
      if (!isValidStorageFolder(folder)) throw badFolder()
      return
    }
    const extension = file.name.split('.').pop()?.toLowerCase()
    switch (providerUploadRejection(file.name, file.type, folder)) {
      case 'folder': throw badFolder()
      case 'extension': throw badType(`Invalid file extension: .${extension}`)
      case 'mime': throw badType(`Invalid MIME type: ${file.type}`)
    }
  }

  /** The tenant of a key when the caller names none. */
  protected fallbackTenantId(): string {
    return 'system'
  }

  protected generateFileKey(tenantId: string, folder: string, filename: string, extension?: string): string {
    const timestamp = Date.now()
    const uuid = uuidv4().slice(0, 8)
    const ext = extension || filename.split('.').pop()?.toLowerCase() || ''
    const baseName = filename.split('.')[0] || 'file'
    return `${tenantId}/${folder}/${timestamp}-${uuid}-${baseName}.${ext}`
  }

  getFileUrl(key: string): string {
    const base = this.cfg.endpoint
      ? `${this.cfg.endpoint.replace(/\/$/, '')}/${this.cfg.bucket}`
      : `https://${this.cfg.bucket}.s3.${this.cfg.region}.amazonaws.com`
    return `${base}/${key}`
  }

  async uploadFile(file: File, options?: UploadOptions): Promise<ProviderUploadResult> {
    const folder = options?.folder || 'general'
    const tenantId = options?.tenantId || this.fallbackTenantId()
    this.validateFile(file, folder, options?.trusted === true)
    const buf = Buffer.from(await file.arrayBuffer())
    const extension = file.name.split('.').pop()?.toLowerCase()
    const key = options?.filename
      ? explicitObjectKey(tenantId, folder, options.filename)
      : this.generateFileKey(tenantId, folder, file.name, extension)
    await this.invoke('putObject', { key, contentBase64: buf.toString('base64'), contentType: options?.trusted === true ? (options?.contentType || file.type) : storedContentType(file.name, options?.contentType || file.type) })
    return { url: this.getFileUrl(key), key, bucket: this.cfg.bucket, size: file.size }
  }

  async uploadFromUrl(url: string, options?: UploadFromUrlOptions): Promise<ProviderUploadResult> {
    const folder = options?.folder || 'general'
    const tenantId = options?.tenantId || this.fallbackTenantId()
    if (!isValidStorageFolder(folder)) throw badFolder()
    const response = await safeFetch(url, { redirect: 'follow' })
    if (!response.ok) throw new Error(`Failed to fetch file from URL: ${response.statusText}`)
    const mimeType = response.headers.get('content-type') || 'application/octet-stream'
    if (!StorageMimeTypeSchema.safeParse(mimeType).success) throw badType(`Invalid MIME type from URL: ${mimeType}`)
    // storage.01: a remote file is read up to the upload ceiling and no further (a declared length above it is refused
    // before the body is read; an undeclared or lying one is cut off while streaming).
    const tooLarge = () => new AppError(STORAGE_MESSAGES.FILE_TOO_LARGE, 413, ErrorCode.VALIDATION_ERROR)
    const declared = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_FILE_BYTES) throw tooLarge()
    const chunks: Uint8Array[] = []
    let total = 0
    if (response.body) {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        total += chunk.byteLength
        if (total > MAX_UPLOAD_FILE_BYTES) throw tooLarge()
        chunks.push(chunk)
      }
    } else {
      const whole = new Uint8Array(await response.arrayBuffer())
      if (whole.byteLength > MAX_UPLOAD_FILE_BYTES) throw tooLarge()
      chunks.push(whole)
    }
    const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)))
    const filename = options?.filename || url.split('?')[0].split('/').pop() || 'file'
    const key = options?.filename
      ? explicitObjectKey(tenantId, folder, options.filename)
      : this.generateFileKey(tenantId, folder, filename)
    await this.invoke('putObject', { key, contentBase64: buf.toString('base64'), contentType: storedContentType(filename, options?.contentType || mimeType) })
    return { url: this.getFileUrl(key), key, bucket: this.cfg.bucket, size: buf.byteLength }
  }

  async deleteFile(key: string): Promise<void> {
    await this.invoke('deleteObject', { key })
  }

  /**
   * Writes `bytes` at exactly `key`, overwriting what is there: no folder rule, no generated name, no allowlists. Only for server code that already
   * vouched for the key and the bytes (a migrated tenant's objects, `storage.migration.ts`, which checks the key lies under the tenant's prefix).
   */
  async putObjectAtKey(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.invoke('putObject', { key, contentBase64: bytes.toString('base64'), contentType })
  }
}
