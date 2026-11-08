import { createHash } from 'node:crypto'
import Logger from '@kuraykaraaslan-labs/logger'
import { env } from '@kuraykaraaslan-labs/env'
import { tenancyMode } from '@kuraykaraaslan-labs/common/server/tenant-path'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import type { S3Config } from './storage.types'
import { presignS3Url } from './storage.sigv4'
import { getStorageSettings } from './storage.provider-factory'
import { auditBucketCorsApplied } from './storage.audit'
import { storageFetch } from './storage.safe-fetch'

/**
 * Bucket CORS for browser-direct uploads. The browser PUTs cross-origin to the
 * bucket (see `storage.direct-upload.ts`), so the bucket needs a CORS rule for
 * every origin the tenant's pages are served on; without it the PUT fails and
 * the client falls back to the 10 MiB multipart route.
 *
 * The tenant admin checks and applies the rule from the storage settings tab.
 * Both go through the S3 bucket CORS API (`GET` / `PUT ?cors`), signed with the
 * tenant's storage settings by the dependency-free SigV4 signer, the same
 * credentials and bucket direct uploads are signed for. Nothing here runs on a
 * read path of an upload: applying is always an admin action.
 *
 * Applying MERGES: the bucket's other rules are kept as they are, and the app's
 * own rule (identified by `DIRECT_UPLOAD_CORS_RULE_ID`) is replaced in place, so
 * applying twice never duplicates it and a domain the tenant removed drops out.
 */

/** `<ID>` of the rule this module writes; a rule with this id is ours to replace. */
export const DIRECT_UPLOAD_CORS_RULE_ID = 'app-storage-direct-uploads'
/** How long a browser may cache the preflight answer. */
export const DIRECT_UPLOAD_CORS_MAX_AGE_SECONDS = 3000
/** AWS caps a bucket's CORS configuration at 100 rules. */
export const MAX_CORS_RULES = 100
/** Validity of the server's own signed requests. */
const SERVER_REQUEST_TTL_SECONDS = 60

export interface CorsRule {
  id?: string
  allowedOrigins: string[]
  allowedMethods: string[]
  allowedHeaders: string[]
  exposeHeaders: string[]
  maxAgeSeconds?: number
}

export type BucketCorsState =
  /** A rule allows a PUT with Content-Type from every app origin. */
  | 'configured'
  /** The bucket has CORS rules, but not for every app origin. */
  | 'missing_origins'
  /** The bucket has no CORS configuration. */
  | 'not_configured'
  /** The store does not implement the bucket CORS API (configure CORS on the store itself). */
  | 'unsupported'
  /** No bucket or signing credentials in the tenant's storage settings. */
  | 'no_credentials'
  /** The tenant stores files locally; there is no bucket. */
  | 'local_provider'
  /** No app origin could be determined (APPLICATION_HOST is not a URL). */
  | 'no_origins'
  /** The access key may not read or write the bucket's CORS configuration. */
  | 'access_denied'
  /** Anything else: the bucket is missing, the store is unreachable, a malformed answer. */
  | 'error'

export interface BucketCorsStatus {
  state: BucketCorsState
  bucket: string | null
  /** The origins the rule must allow: every origin the tenant's pages are served on. */
  origins: string[]
  /** Origins no rule allows a PUT with Content-Type from. */
  missingOrigins: string[]
  /** The store's error code, for 'unsupported', 'access_denied' and 'error'. */
  code?: string
  /** The store's HTTP status, for 'unsupported', 'access_denied' and 'error'. */
  httpStatus?: number
}

export interface BucketCorsApplyResult {
  applied: boolean
  status: BucketCorsStatus
}

// ── XML ─────────────────────────────────────────────────────────────────────

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
const xmlEscape = (s: string) => s.replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!)
const xmlUnescape = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|quot|apos|amp);/gi, (_, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
    return ({ lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' } as Record<string, string>)[e.toLowerCase()]!
  })

function elements(block: string, tag: string): string[] {
  return [...block.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => xmlUnescape(m[1]!.trim()))
}

/**
 * The rules of a `CORSConfiguration` document. The configuration is flat (a list
 * of rules, each a list of single-value elements), so it is read without an XML
 * dependency; every element a CORS rule can carry is kept, so a rule written
 * back is the rule that was read.
 */
export function parseCorsXml(xml: string): CorsRule[] {
  return [...xml.matchAll(/<CORSRule(?:\s[^>]*)?>([\s\S]*?)<\/CORSRule>/g)].map(([, block]) => {
    const id = elements(block!, 'ID')[0]
    const maxAge = elements(block!, 'MaxAgeSeconds')[0]
    return {
      ...(id ? { id } : {}),
      allowedOrigins: elements(block!, 'AllowedOrigin'),
      allowedMethods: elements(block!, 'AllowedMethod'),
      allowedHeaders: elements(block!, 'AllowedHeader'),
      exposeHeaders: elements(block!, 'ExposeHeader'),
      ...(maxAge !== undefined && /^\d+$/.test(maxAge) ? { maxAgeSeconds: Number(maxAge) } : {}),
    }
  })
}

/** A `CORSConfiguration` document, elements in the order the AWS SDK writes them. */
export function buildCorsXml(rules: CorsRule[]): string {
  const el = (tag: string, value: string) => `<${tag}>${xmlEscape(value)}</${tag}>`
  const body = rules.map((r) => '<CORSRule>'
    + (r.id ? el('ID', r.id) : '')
    + r.allowedHeaders.map((v) => el('AllowedHeader', v)).join('')
    + r.allowedMethods.map((v) => el('AllowedMethod', v)).join('')
    + r.allowedOrigins.map((v) => el('AllowedOrigin', v)).join('')
    + r.exposeHeaders.map((v) => el('ExposeHeader', v)).join('')
    + (r.maxAgeSeconds !== undefined ? el('MaxAgeSeconds', String(r.maxAgeSeconds)) : '')
    + '</CORSRule>').join('')
  return `<?xml version="1.0" encoding="UTF-8"?><CORSConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/">${body}</CORSConfiguration>`
}

/** `Content-MD5` of a request body: base64 of its MD5 digest. PutBucketCors refuses a request without it. */
export function contentMd5(body: string): string {
  return createHash('md5').update(body, 'utf8').digest('base64')
}

/** The `<Code>` of an S3 error document. */
export function s3ErrorCode(body: string): string | undefined {
  return /<Code>([^<]+)<\/Code>/.exec(body)?.[1]?.trim() || undefined
}

// ── The rule ────────────────────────────────────────────────────────────────

/**
 * The rule direct uploads need. PUT is the upload itself; HEAD lets a client
 * check an object it just wrote. AllowedHeader is `content-type`, not `*`: the
 * PUT is the only cross-origin request the app makes and Content-Type is the
 * only header it sets (Content-Length is the browser's own and never part of a
 * preflight), so the rule approves exactly that rather than any header a page
 * might add. ExposeHeader ETag lets the page read the object's ETag. The
 * origins are always explicit; `*` is never written.
 */
export function directUploadCorsRule(origins: string[]): CorsRule {
  return {
    id: DIRECT_UPLOAD_CORS_RULE_ID,
    allowedOrigins: [...origins],
    allowedMethods: ['PUT', 'HEAD'],
    allowedHeaders: ['content-type'],
    exposeHeaders: ['ETag'],
    maxAgeSeconds: DIRECT_UPLOAD_CORS_MAX_AGE_SECONDS,
  }
}

const sameSet = (a: string[], b: string[], fold = false) => {
  const norm = (xs: string[]) => [...new Set(xs.map((x) => (fold ? x.toLowerCase() : x)))].sort().join('\n')
  return norm(a) === norm(b)
}

/**
 * The bucket's rules with ours in them: a rule carrying our id is replaced where
 * it stands (the first one; any later copy is dropped), an id-less rule with
 * exactly our content (the manual rule the README used to ask for) is folded
 * into it, every other rule is kept unchanged and in order, and ours is appended
 * when it was not there yet.
 */
export function mergeCorsRules(existing: CorsRule[], ours: CorsRule): CorsRule[] {
  const isOurs = (r: CorsRule) => r.id === ours.id || (!r.id
    && sameSet(r.allowedOrigins, ours.allowedOrigins)
    && sameSet(r.allowedMethods, ours.allowedMethods, true)
    && sameSet(r.allowedHeaders, ours.allowedHeaders, true)
    && sameSet(r.exposeHeaders, ours.exposeHeaders, true))
  const out: CorsRule[] = []
  let placed = false
  for (const rule of existing) {
    if (!isOurs(rule)) out.push(rule)
    else if (!placed) { out.push(ours); placed = true }
  }
  if (!placed) out.push(ours)
  return out
}

/** S3 wildcard match: a pattern may hold `*` (S3 allows one per origin) standing for any run of characters. */
function wildcardMatch(pattern: string, value: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i')
  return re.test(value)
}

/** Which origins some rule allows a PUT with a Content-Type header from (the browser's preflight for the upload). */
export function corsCoverage(rules: CorsRule[], origins: string[]): { covered: string[]; missing: string[] } {
  const allows = (r: CorsRule, origin: string) =>
    r.allowedMethods.some((m) => m.toUpperCase() === 'PUT')
    && r.allowedOrigins.some((p) => wildcardMatch(p, origin))
    && r.allowedHeaders.some((p) => wildcardMatch(p, 'content-type'))
  const covered = origins.filter((o) => rules.some((r) => allows(r, o)))
  return { covered, missing: origins.filter((o) => !covered.includes(o)) }
}

type ResponseState = Pick<BucketCorsStatus, 'state' | 'missingOrigins' | 'code' | 'httpStatus'>

/**
 * Map the store's answer to `GET ?cors` (or `PUT ?cors`) to a state. 404
 * NoSuchCORSConfiguration is "not configured", 501 / NotImplemented (MinIO, some
 * gateways) is "unsupported", 403 is "access denied"; a 200 is checked against
 * the origins.
 */
export function corsStateFromResponse(httpStatus: number, body: string, origins: string[]): ResponseState {
  if (httpStatus === 200) {
    const rules = parseCorsXml(body)
    if (rules.length === 0) return { state: 'not_configured', missingOrigins: [...origins] }
    const { missing } = corsCoverage(rules, origins)
    return { state: missing.length ? 'missing_origins' : 'configured', missingOrigins: missing }
  }
  const code = s3ErrorCode(body)
  if (httpStatus === 404 && code === 'NoSuchCORSConfiguration') return { state: 'not_configured', missingOrigins: [...origins] }
  if (httpStatus === 501 || code === 'NotImplemented') return { state: 'unsupported', missingOrigins: [...origins], code: code ?? 'NotImplemented', httpStatus }
  if (httpStatus === 403) return { state: 'access_denied', missingOrigins: [...origins], code: code ?? 'AccessDenied', httpStatus }
  return { state: 'error', missingOrigins: [...origins], code, httpStatus }
}

// ── Origins ─────────────────────────────────────────────────────────────────

/** The tenant's verified domains (custom domains and its platform subdomain), when tenant_domain is installed. */
async function verifiedTenantDomains(tenantId: string): Promise<string[]> {
  try {
    const { default: TenantDomainCrudService } = await import('@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.crud.service')
    const { domains } = await TenantDomainCrudService.getByTenantId({ tenantId, page: 1, pageSize: MAX_CORS_RULES })
    return domains.filter((d) => d.domainStatus === 'ACTIVE' || d.domainStatus === 'VERIFIED').map((d) => d.domain)
  } catch (error) {
    Logger.debug(`bucket cors: tenant domain lookup failed for ${tenantId}: ${error instanceof Error ? error.message : String(error)}`)
    return []
  }
}

/**
 * Every origin the tenant's pages (and so its uploads) can run on:
 *
 * - the platform host, `APPLICATION_HOST` (and `NEXT_PUBLIC_APPLICATION_HOST`
 *   when it differs); in path mode it is the only host, in domain mode it still
 *   serves every tenant under `/tenant/<id>`;
 * - in domain mode (`subdomain` is an alias of it), the tenant's ACTIVE and
 *   VERIFIED domains, which include the `<slug>.<wildcard>` subdomain the
 *   platform provisions, on the platform host's scheme (as `tenant_domain.url`
 *   builds them);
 * - for the root tenant in domain mode, the wildcard apex and its
 *   `<TENANT_DEFAULT_SUBDOMAIN>.<wildcard>` host, which the proxy maps to it.
 *
 * Exact origins only: never a wildcard, so another tenant's domain is never
 * allowed on this tenant's bucket.
 */
export async function tenantAppOrigins(tenantId: string): Promise<string[]> {
  const origins = new Set<string>()
  const add = (raw?: string | null) => {
    if (!raw) return
    try {
      const u = new URL(raw.trim())
      if (u.protocol === 'https:' || u.protocol === 'http:') origins.add(u.origin)
    } catch { /* not a URL: skipped */ }
  }
  const appHost = env.APPLICATION_HOST || 'http://localhost:3000'
  add(appHost)
  add(env.NEXT_PUBLIC_APPLICATION_HOST)

  if (tenancyMode() === 'domain') {
    let scheme = 'https:'
    try { scheme = new URL(appHost).protocol } catch { /* keep https */ }
    const wildcard = (env.TENANT_WILDCARD_DOMAIN || '').trim().toLowerCase()
    if (isRootTenant(tenantId) && wildcard) {
      add(`${scheme}//${wildcard}`)
      add(`${scheme}//${env.TENANT_DEFAULT_SUBDOMAIN || 'system'}.${wildcard}`)
    }
    for (const domain of await verifiedTenantDomains(tenantId)) add(`${scheme}//${domain.toLowerCase()}`)
  }
  return [...origins].sort()
}

// ── Status / apply ──────────────────────────────────────────────────────────

type Target =
  | { status: BucketCorsStatus }
  | { status: null; config: S3Config; origins: string[] }

async function resolveTarget(tenantId: string): Promise<Target> {
  const { providerName, config } = await getStorageSettings(tenantId)
  const origins = await tenantAppOrigins(tenantId)
  const base = { bucket: config.bucket || null, origins, missingOrigins: [...origins] }
  if (providerName === 'local') return { status: { ...base, state: 'local_provider' } }
  if (!config.bucket || !config.accessKeyId || !config.secretAccessKey) return { status: { ...base, state: 'no_credentials' } }
  if (origins.length === 0) return { status: { ...base, state: 'no_origins' } }
  return { status: null, config, origins }
}

/**
 * A signed request to the bucket's `?cors` subresource. The body of a PUT is
 * bound by a signed Content-MD5. A network failure (or an endpoint that is not
 * a URL) answers null.
 */
async function corsRequest(config: S3Config, method: 'GET' | 'PUT', body?: string): Promise<{ status: number; text: string } | null> {
  const headers: Record<string, string> = body === undefined ? {} : { 'content-md5': contentMd5(body), 'content-type': 'application/xml' }
  try {
    const url = presignS3Url(config, method, '', { expiresSeconds: SERVER_REQUEST_TTL_SECONDS, query: { cors: '' }, headers })
    const res = await storageFetch(url, { method, headers, body }) // storage.08
    return { status: res.status, text: await res.text() }
  } catch (error) {
    Logger.warn(`bucket cors: ${method} ?cors failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}

const baseOf = (config: S3Config, origins: string[]) => ({ bucket: config.bucket, origins, missingOrigins: [...origins] })
const unreachable = (base: Omit<BucketCorsStatus, 'state'>): BucketCorsStatus => ({ ...base, state: 'error', code: 'StorageUnreachable' })

async function readStatus(config: S3Config, origins: string[]): Promise<BucketCorsStatus> {
  const res = await corsRequest(config, 'GET')
  if (!res) return unreachable(baseOf(config, origins))
  return { ...baseOf(config, origins), ...corsStateFromResponse(res.status, res.text, origins) }
}

/** Does the tenant's bucket let the browser PUT from every app origin? Read-only. */
export async function getBucketCorsStatus(tenantId: string): Promise<BucketCorsStatus> {
  const target = await resolveTarget(tenantId)
  return target.status ?? readStatus(target.config, target.origins)
}

export interface ApplyBucketCorsContext {
  userId?: string
  origin?: { ip?: string; userAgent?: string }
}

/**
 * Merge the direct-upload rule into the bucket's CORS configuration. The
 * current configuration is read first and written back with ours merged in;
 * when it cannot be read (anything but a 200 or "no configuration"), nothing is
 * written, so the bucket's other rules are never lost. Audited when applied.
 */
export async function applyBucketCors(tenantId: string, ctx: ApplyBucketCorsContext = {}): Promise<BucketCorsApplyResult> {
  const target = await resolveTarget(tenantId)
  if (target.status) return { applied: false, status: target.status }
  const { config, origins } = target
  const base = baseOf(config, origins)

  const current = await corsRequest(config, 'GET')
  if (!current) return { applied: false, status: unreachable(base) }
  const read = corsStateFromResponse(current.status, current.text, origins)
  if (current.status !== 200 && read.state !== 'not_configured') return { applied: false, status: { ...base, ...read } }

  const existing = current.status === 200 ? parseCorsXml(current.text) : []
  const rules = mergeCorsRules(existing, directUploadCorsRule(origins))
  if (rules.length > MAX_CORS_RULES) return { applied: false, status: { ...base, state: 'error', code: 'TooManyCORSRules' } }

  const written = await corsRequest(config, 'PUT', buildCorsXml(rules))
  if (!written) return { applied: false, status: unreachable(base) }
  if (written.status < 200 || written.status >= 300) {
    const failed = corsStateFromResponse(written.status, written.text, origins)
    // A store that reads `?cors` but refuses to write it gets no "not configured" answer back.
    return { applied: false, status: { ...base, ...failed, state: failed.state === 'not_configured' ? 'error' : failed.state } }
  }

  await auditBucketCorsApplied(tenantId, ctx.userId, config.bucket, {
    // The endpoint already signed a request, so it parses.
    endpoint: config.endpoint ? new URL(config.endpoint).host : 'aws',
    origins,
    rulesBefore: existing.length,
    rulesAfter: rules.length,
  }, ctx.origin)
  // Read back what the store now answers, rather than what was sent.
  return { applied: true, status: await readStatus(config, origins) }
}
