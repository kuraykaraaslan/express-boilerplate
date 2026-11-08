import { createHash, createHmac } from 'node:crypto'
import type { S3Config } from './storage.types'

/**
 * AWS Signature Version 4 query presigning for S3-compatible object stores
 * (AWS S3, Cloudflare R2, DigitalOcean Spaces, MinIO). Generates real,
 * time-limited URLs (GET, HEAD, PUT, DELETE) with no external dependency
 * (`@aws-sdk/s3-request-presigner` is not installed). The signature is computed exactly per the SigV4 spec, so
 * the resulting URL is accepted by any compliant endpoint.
 *
 * Presigned URLs let a tenant hand out a short-lived download link, and let a
 * browser PUT an upload straight to the bucket, without exposing credentials
 * or making the bucket public.
 */

const UNSIGNED = 'UNSIGNED-PAYLOAD'

function sha256Hex(data: string): string {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}
function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

/**
 * RFC 3986 encode, as SigV4 requires: every byte of the UTF-8 encoding outside
 * the unreserved set becomes `%XX` (a non-ASCII character is several bytes, so
 * several escapes). S3 keys keep `/` unencoded for the canonical path.
 */
function uriEncode(str: string, encodeSlash = true): string {
  let out = ''
  for (const byte of Buffer.from(str, 'utf8')) {
    const ch = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-_.~]/.test(ch) || (ch === '/' && !encodeSlash)) out += ch
    else out += '%' + byte.toString(16).toUpperCase().padStart(2, '0')
  }
  return out
}

function hostFor(config: S3Config): { host: string; scheme: string; pathStyle: boolean } {
  if (config.endpoint) {
    const u = new URL(config.endpoint)
    // Custom endpoints (R2/Spaces/MinIO) use path-style: <host>/<bucket>/<key>.
    return { host: u.host, scheme: u.protocol.replace(':', ''), pathStyle: true }
  }
  return { host: `${config.bucket}.s3.${config.region}.amazonaws.com`, scheme: 'https', pathStyle: false }
}

/** Methods a presigned URL is issued for. */
export type PresignMethod = 'GET' | 'HEAD' | 'PUT' | 'DELETE'

export interface PresignOptions {
  /** Validity in seconds (default 900, clamped to 1 s .. 7 days). */
  expiresSeconds?: number
  /**
   * Headers the request must carry with exactly these values. They join `host`
   * as signed headers, so a client cannot change them without breaking the
   * signature (a browser PUT bound to its Content-Type and Content-Length, a
   * server-side copy bound to its source). Values must not contain newlines.
   */
  headers?: Record<string, string>
  /**
   * Extra query parameters, signed with the rest of the query: a subresource such
   * as `{ cors: '' }` (bucket CORS configuration) or a list parameter.
   */
  query?: Record<string, string>
}

/**
 * Build a presigned URL for `method` on `key`. Query-string auth with an
 * unsigned payload: the body (if any) is not hashed, which every S3-compatible
 * store accepts for presigned requests. An empty `key` addresses the bucket
 * itself (`/<bucket>` path-style, `/` virtual-hosted), for bucket operations
 * like `PUT ?cors` or creating the bucket.
 */
export function presignS3Url(config: S3Config, method: PresignMethod, key: string, opts: PresignOptions = {}): string {
  const region = config.region || 'us-east-1'
  const service = 's3'
  const expires = Math.min(Math.max(opts.expiresSeconds ?? 900, 1), 7 * 24 * 3600)

  const { host, scheme, pathStyle } = hostFor(config)
  const objectPath = key ? '/' + uriEncode(key, false) : ''
  const canonicalUri = pathStyle
    ? '/' + uriEncode(config.bucket, false) + objectPath
    : objectPath || '/'

  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`

  // Signed headers: always `host`, plus whatever the caller binds. Names are
  // lowercased and sorted, values trimmed, per the canonical-request rules.
  const signed: Record<string, string> = { host }
  for (const [name, value] of Object.entries(opts.headers ?? {})) signed[name.toLowerCase()] = String(value).trim()
  const headerNames = Object.keys(signed).sort()
  const signedHeaders = headerNames.join(';')

  const query: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
  }
  for (const [name, value] of Object.entries(opts.query ?? {})) {
    if (Object.hasOwn(query, name) || name === 'X-Amz-Signature') throw new Error(`presignS3Url: query parameter ${name} is reserved`)
    query[name] = value
  }
  // Sorted by the ENCODED name, as the canonical-request rules require.
  const canonicalQuery = Object.entries(query)
    .map(([k, v]) => [uriEncode(k), uriEncode(v)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const canonicalHeaders = headerNames.map((name) => `${name}:${signed[name]}\n`).join('')
  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED,
  ].join('\n')

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const kDate = hmac('AWS4' + config.secretAccessKey, dateStamp)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, service)
  const kSigning = hmac(kService, 'aws4_request')
  const signature = createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex')

  return `${scheme}://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

/**
 * Build a presigned GET URL valid for `expiresSeconds` (default 900, max 7 days).
 */
export function presignS3GetUrl(
  config: S3Config,
  key: string,
  expiresSeconds = 900,
  opts: { contentDisposition?: string } = {},
): string {
  // `response-content-disposition` is a signed query parameter every S3-compatible store honours on a presigned GET:
  // the object is answered as a download under the given name (drive's Download, 41-ui-fixes/10 3.10).
  if (opts.contentDisposition) {
    return presignS3Url(config, 'GET', key, { expiresSeconds, query: { 'response-content-disposition': opts.contentDisposition } })
  }
  return presignS3Url(config, 'GET', key, { expiresSeconds })
}

/**
 * Build a presigned PUT URL for a browser-direct upload. The Content-Type is a
 * signed header, and so is the Content-Length when given: the store refuses a
 * PUT whose body is not exactly the declared size or type, so the object can
 * only ever be the file the server validated the declaration of.
 */
export function presignS3PutUrl(
  config: S3Config,
  key: string,
  opts: { contentType: string; contentLength?: number; expiresSeconds?: number },
): string {
  const headers: Record<string, string> = { 'content-type': opts.contentType }
  if (opts.contentLength != null) headers['content-length'] = String(opts.contentLength)
  return presignS3Url(config, 'PUT', key, { expiresSeconds: opts.expiresSeconds, headers })
}
