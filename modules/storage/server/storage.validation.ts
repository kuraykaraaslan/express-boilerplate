import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { STORAGE_MESSAGES } from './storage.messages'

/**
 * Real upload validation — defends against content-type spoofing and oversized
 * or disallowed files BEFORE the bytes reach the bucket. No mock: every check
 * inspects the actual file content (magic bytes), not just the declared type.
 *
 *  1. Size       — enforced against `maxFileSizeMb`.
 *  2. Extension  — enforced against `allowedExtensions`.
 *  3. Magic byte — the file's real signature must be consistent with its
 *                  extension / declared MIME (blocks `evil.exe` renamed to
 *                  `cat.png`).
 *
 * Optionally strips EXIF/metadata from JPEGs (privacy: GPS, device, thumbnails).
 */

export interface UploadValidationPolicy {
  maxBytes: number            // 0 = unlimited
  allowedExtensions: string[] // empty = allow all (getValidationPolicy never returns empty: it applies the deny-by-default list, 38-security 4.5); a name with no extension is refused when set
  allowedMimeTypes: string[]  // empty = allow all (matched against content-derived MIME)
  stripExif: boolean
}

/**
 * The largest upload request body that reaches the storage and Drive routes
 * whole. Both routes sit behind the proxy (proxy.ts), and Next clones the body of
 * every non-GET request the proxy matches, cutting the clone off at
 * `experimental.proxyClientMaxBodySize`: 10 MiB by default, and next.config does
 * not raise it. Past that the route parses a truncated multipart body and the
 * upload fails. Raising the option is not a fix (the proxy-side copy is buffered
 * as well); browser-direct uploads to the bucket are. Keep this in step with
 * next.config if that option is ever set. The later hops are not the binding
 * limit: the plugin broker is outside the proxy matcher, and the plugin-host takes
 * a 16 MB run body, which a base64 file of this size still fits in.
 */
export const UPLOAD_REQUEST_CEILING_BYTES = 10 * 1024 * 1024

/**
 * Room left in the request for the multipart framing around the file: boundary
 * lines, part headers and the small text fields (folder, provider, parentId).
 */
export const MULTIPART_OVERHEAD_BYTES = 64 * 1024

/** The largest file one upload request can carry, whatever the tenant setting says. */
export const MAX_UPLOAD_FILE_BYTES = UPLOAD_REQUEST_CEILING_BYTES - MULTIPART_OVERHEAD_BYTES

/**
 * The effective per-file cap for a `maxFileSizeMb` setting value. A setting above
 * the transport ceiling is clamped to it, and a missing or unusable one means the
 * ceiling rather than "unlimited", so a tenant is never promised a size that
 * always fails in transit.
 */
export function effectiveMaxUploadBytes(maxFileSizeMb: string | undefined): number {
  const mb = parseInt(maxFileSizeMb ?? '', 10)
  if (!Number.isFinite(mb) || mb <= 0) return MAX_UPLOAD_FILE_BYTES
  return Math.min(mb * 1024 * 1024, MAX_UPLOAD_FILE_BYTES)
}

/**
 * The largest file a browser-direct upload (presign, PUT to the bucket, complete)
 * may declare, whatever `maxFileSizeMb` says. Those bytes never cross the app,
 * so the request ceiling above does not apply; one presigned PUT could carry
 * 5 GB on S3, but nothing resumes a failed single PUT, so the cap stays just
 * above the largest plan template (500 MB).
 */
export const DIRECT_UPLOAD_MAX_BYTES = 512 * 1024 * 1024

/**
 * The effective per-file cap of a direct upload for a `maxFileSizeMb` value: the
 * setting itself up to `DIRECT_UPLOAD_MAX_BYTES`. A missing or unusable setting
 * still means the multipart ceiling, as in `effectiveMaxUploadBytes`, so leaving
 * the setting unset never widens what a tenant accepts.
 */
export function effectiveDirectUploadMaxBytes(maxFileSizeMb: string | undefined): number {
  const mb = parseInt(maxFileSizeMb ?? '', 10)
  if (!Number.isFinite(mb) || mb <= 0) return MAX_UPLOAD_FILE_BYTES
  return Math.min(mb * 1024 * 1024, DIRECT_UPLOAD_MAX_BYTES)
}

/**
 * True when a declared Content-Length is more than an upload of at most
 * `maxFileBytes` can need (the file plus its multipart framing), so a route can
 * answer 413 before `formData()` buffers the whole body. A missing or malformed
 * header is not judged here: `validateUpload` still checks the real file size.
 */
export function declaredUploadTooLarge(contentLength: string | null, maxFileBytes: number): boolean {
  const raw = contentLength?.trim()
  if (!raw || !/^\d+$/.test(raw)) return false
  return Number(raw) > maxFileBytes + MULTIPART_OVERHEAD_BYTES
}

/** Leading magic-byte signatures keyed by canonical extension. */
const SIGNATURES: Array<{ ext: string; test: (b: Uint8Array) => boolean }> = [
  { ext: 'jpg',  test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png',  test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'gif',  test: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 },
  { ext: 'webp', test: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  { ext: 'bmp',  test: (b) => b[0] === 0x42 && b[1] === 0x4d },
  { ext: 'pdf',  test: (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 },
  { ext: 'zip',  test: (b) => b[0] === 0x50 && b[1] === 0x4b && (b[2] === 0x03 || b[2] === 0x05 || b[2] === 0x07) },
  { ext: 'gz',   test: (b) => b[0] === 0x1f && b[1] === 0x8b },
  { ext: 'mp4',  test: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70 }, // 'ftyp'
  { ext: 'mp3',  test: (b) => (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) },
  { ext: 'ico',  test: (b) => b[0] === 0x00 && b[1] === 0x00 && b[2] === 0x01 && b[3] === 0x00 },
  // storage.06: AVIF is an ISO-BMFF file: an 'ftyp' box at offset 4 whose brands (the major brand at offset 8, or one of
  // the compatible brands after it, e.g. a 'mif1' major brand) include 'avif' (image) or 'avis' (sequence).
  { ext: 'avif', test: (b) => {
    if (!(b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70)) return false
    const boxEnd = Math.min(b.length, ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0)
    for (let i = 8; i + 4 <= boxEnd; i += 4) {
      if (b[i] === 0x61 && b[i + 1] === 0x76 && b[i + 2] === 0x69 && (b[i + 3] === 0x66 || b[i + 3] === 0x73)) return true
    }
    return false
  } },
]

// Extensions that are plain text / structured text — content sniffing is not
// meaningful, so we accept them on extension + size alone.
const TEXTUAL = new Set(['txt', 'csv', 'json', 'xml', 'svg', 'md', 'html', 'yaml', 'yml'])

// Office/zip-container formats share the ZIP signature.
const ZIP_FAMILY = new Set(['zip', 'docx', 'xlsx', 'pptx', 'odt', 'ods', 'epub'])

/**
 * Canonical MIME type per extension. Used to derive the *real* MIME from the
 * (already magic-byte-validated) extension instead of trusting the client's
 * `file.type` header. Unknown extensions fall back to octet-stream.
 */
const EXT_MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon',
  svg: 'image/svg+xml',
  pdf: 'application/pdf', zip: 'application/zip', gz: 'application/gzip',
  mp4: 'video/mp4', mp3: 'audio/mpeg',
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'application/xml',
  md: 'text/markdown', html: 'text/html', yaml: 'application/x-yaml', yml: 'application/x-yaml',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odt: 'application/vnd.oasis.opendocument.text',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  epub: 'application/epub+zip',
}

/**
 * Derive the real MIME type from the validated extension. Because
 * `magicConsistent` has already confirmed the bytes match the extension, the
 * extension is a trustworthy (content-grounded) signal — unlike the
 * client-supplied `file.type` header.
 */
export function deriveMimeType(ext: string): string {
  return EXT_MIME[ext] ?? 'application/octet-stream'
}

function extOf(filename: string): string {
  const i = filename.lastIndexOf('.')
  return i === -1 ? '' : filename.slice(i + 1).toLowerCase()
}

/** True when the buffer's magic bytes are consistent with the claimed extension. */
function magicConsistent(ext: string, head: Uint8Array): boolean {
  if (TEXTUAL.has(ext)) return true
  if (ZIP_FAMILY.has(ext)) return SIGNATURES.find((s) => s.ext === 'zip')!.test(head)
  const sig = SIGNATURES.find((s) => s.ext === ext)
  if (!sig) return true // unknown type → no signature to assert (extension allowlist already gates)
  return sig.test(head)
}

/**
 * True when the leading bytes of an object are consistent with its name's
 * extension: the magic-byte check of `validateUpload`, for bytes that reached the
 * bucket without passing through the app (browser-direct uploads).
 */
export function contentMatchesExtension(filename: string, head: Uint8Array): boolean {
  const ext = extOf(filename)
  return !ext || magicConsistent(ext, head)
}

/**
 * Check an upload's declared name before any byte exists, the way
 * `validateUpload` checks a received file: the extension allowlist, then the
 * tenant's MIME allowlist against the MIME derived from the extension (the
 * client's type is never trusted). The magic bytes can only be checked once the
 * object is in the bucket (`contentMatchesExtension`).
 */
export function validateDeclaredName(filename: string, policy: UploadValidationPolicy): { ext: string; mimeType: string } {
  const ext = extOf(filename)
  if (policy.allowedExtensions.length > 0 && (!ext || !policy.allowedExtensions.includes(ext))) {
    throw new AppError(STORAGE_MESSAGES.EXTENSION_NOT_ALLOWED, 422, ErrorCode.VALIDATION_ERROR)
  }
  const mimeType = deriveMimeType(ext)
  if (policy.allowedMimeTypes.length > 0 && !policy.allowedMimeTypes.includes(mimeType)) {
    throw new AppError(STORAGE_MESSAGES.INVALID_MIME_TYPE, 422, ErrorCode.VALIDATION_ERROR)
  }
  return { ext, mimeType }
}

/** Refuse a declared size the way `validateUpload` refuses a received one: empty is 422, over `maxBytes` is 413. */
export function assertDeclaredSize(size: number, maxBytes: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new AppError(STORAGE_MESSAGES.EMPTY_FILE, 422, ErrorCode.VALIDATION_ERROR)
  // details.maxBytes lets the client name the limit (common/ui/direct-upload.client).
  if (maxBytes > 0 && size > maxBytes) throw new AppError(STORAGE_MESSAGES.FILE_TOO_LARGE, 413, ErrorCode.VALIDATION_ERROR, { details: { maxBytes } })
}

/**
 * Strip EXIF / metadata APPn (and COM) segments from a JPEG, keeping image
 * scan data intact. Pure JS, no dependency. Non-JPEG buffers are returned
 * unchanged. Removes GPS location, camera/device info, and thumbnails.
 *
 * The walk only records the [start, end) ranges to keep and copies them with
 * one Buffer.concat at the end: copying byte by byte into a JS array blocked
 * the event loop for ~110 ms on a 5 MB photo. When nothing is dropped the
 * input itself is returned, so a clean JPEG costs no copy at all. Segment ends
 * are clamped to the buffer, so a truncated file never reads past its end.
 */
export function stripJpegMetadata(buf: Uint8Array): Uint8Array {
  if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return buf
  const keep: Array<[number, number]> = [[0, 2]] // SOI
  const pushRange = (start: number, end: number) => {
    const last = keep[keep.length - 1]
    if (last[1] === start) last[1] = end // adjacent kept segments merge into one copy
    else keep.push([start, end])
  }
  let i = 2
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) break
    const marker = buf[i + 1]
    // Start of Scan — keep the rest verbatim (compressed image data).
    if (marker === 0xda) { pushRange(i, buf.length); break }
    if (i + 3 >= buf.length) break // no room for the length field
    const len = (buf[i + 2] << 8) + buf[i + 3]
    // A length below 2 cannot even cover itself: the file is malformed, so stop
    // rather than walk the rest as markers.
    if (len < 2) break
    const end = Math.min(i + 2 + len, buf.length)
    const isMeta = (marker >= 0xe0 && marker <= 0xef) || marker === 0xfe // APPn or COM
    if (!isMeta) pushRange(i, end)
    i = end
  }
  if (keep.length === 1 && keep[0][0] === 0 && keep[0][1] === buf.length) return buf
  return Buffer.concat(keep.map(([start, end]) => buf.subarray(start, end)))
}

/**
 * Validate (and optionally sanitise) an upload. Returns the file to actually
 * store (same instance, or a new one with metadata stripped) plus the *real*
 * content-derived MIME type — never the client-supplied `file.type`.
 */
export async function validateUpload(
  file: File,
  policy: UploadValidationPolicy,
): Promise<{ file: File; mimeType: string }> {
  if (!file || file.size === 0) throw new AppError(STORAGE_MESSAGES.EMPTY_FILE, 422, ErrorCode.VALIDATION_ERROR)

  if (policy.maxBytes > 0 && file.size > policy.maxBytes) {
    throw new AppError(STORAGE_MESSAGES.FILE_TOO_LARGE, 413, ErrorCode.VALIDATION_ERROR, { details: { maxBytes: policy.maxBytes } })
  }

  const ext = extOf(file.name)
  if (policy.allowedExtensions.length > 0 && (!ext || !policy.allowedExtensions.includes(ext))) {
    throw new AppError(STORAGE_MESSAGES.EXTENSION_NOT_ALLOWED, 422, ErrorCode.VALIDATION_ERROR)
  }

  // Only the first 16 bytes are needed for the signature check. Reading the
  // whole file here made a full copy of every upload even when nothing is
  // stripped and the original File is passed on as is.
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  if (ext && !magicConsistent(ext, head)) {
    throw new AppError(STORAGE_MESSAGES.MIME_MISMATCH, 422, ErrorCode.VALIDATION_ERROR)
  }

  // Derive the true MIME from the (now content-verified) extension and enforce
  // the tenant's MIME allowlist against it — not against the spoofable header.
  const mimeType = deriveMimeType(ext)
  if (policy.allowedMimeTypes.length > 0 && !policy.allowedMimeTypes.includes(mimeType)) {
    throw new AppError(STORAGE_MESSAGES.INVALID_MIME_TYPE, 422, ErrorCode.VALIDATION_ERROR)
  }

  if (policy.stripExif && (ext === 'jpg' || ext === 'jpeg')) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const stripped = stripJpegMetadata(bytes)
    if (stripped.length !== bytes.length) {
      return { file: new File([stripped as unknown as BlobPart], file.name, { type: mimeType }), mimeType }
    }
  }
  // Re-stamp the file with the derived MIME so the provider's ContentType and
  // the audit row both carry the real type rather than the client's header.
  // Wrapping the original File as the part keeps its bytes without reading
  // them into memory again.
  if (file.type !== mimeType) {
    return { file: new File([file], file.name, { type: mimeType }), mimeType }
  }
  return { file, mimeType }
}
