import { createHash, randomBytes } from 'node:crypto'
import redis from '@kuraykaraaslan-labs/redis'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { IsNull } from 'typeorm'
import { UploadedFile } from './entities/uploaded_file.entity'
import { STORAGE_MESSAGES } from './storage.messages'
import { isStagingKey } from './storage.direct-upload.store'

/**
 * App-signed download links for machine clients (a device, a CI job, a partner
 * system) — docs/phases/15-storage/01. A link is `GET /api/storage/links/<token>`: no
 * cookie, no header, works the same on every storage provider, expires,
 * optionally single-use / audience-bound, and can be revoked.
 *
 * Only `sha256(token)` is stored (the `api_key` keyHash precedent), so a Redis
 * dump cannot be replayed. The `linkId` handed back to the creator IS that
 * hash — it identifies the link for list / revoke and cannot be turned back
 * into the token.
 */

export const DEFAULT_LINK_MAX_TTL_SECONDS = 24 * 3600
/** Absolute ceiling regardless of the setting (matches the SigV4 limit). */
export const HARD_LINK_MAX_TTL_SECONDS = 7 * 24 * 3600
export const SETTING_LINK_MAX_TTL = 'storageLinkMaxTtlSeconds'

const linkKey = (hash: string) => `storage:link:${hash}`
const claimKey = (hash: string) => `storage:link-claim:${hash}`
const indexKey = (tenantId: string) => `storage:links:${tenantId}`

export interface CreateDownloadLinkOptions {
  /** Requested lifetime; clamped to the platform ceiling. */
  ttlSeconds: number
  /** First client wins; resumes by the same client (audience or IP) stay allowed. */
  singleUse?: boolean
  /** Opaque string (e.g. a device id); the route then requires `?aud=` to match. */
  audience?: string
  /** Suggested download name (Content-Disposition). */
  filename?: string
  contentType?: string
  /** Free-form tag for audit / listing, e.g. `iot_ota.firmware`. */
  purpose: string
  /** S3-compatible providers: allow a 302 to a fresh 60 s SigV4 URL (default true). */
  redirectAllowed?: boolean
}

export interface DownloadLinkRecord {
  tenantId: string
  key: string
  expiresAt: number
  singleUse: boolean
  audience?: string
  purpose: string
  filename?: string
  contentType?: string
  redirectAllowed: boolean
  createdAt: number
}

export interface CreatedDownloadLink {
  url: string
  expiresAt: Date
  linkId: string
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** The ceiling for any link's TTL — the ROOT tenant's setting (platform-level), default 24 h. */
export async function getLinkMaxTtlSeconds(): Promise<number> {
  let configured = DEFAULT_LINK_MAX_TTL_SECONDS
  try {
    const raw = await SettingService.getValue(ROOT_TENANT_ID, SETTING_LINK_MAX_TTL)
    const n = parseInt(raw ?? '', 10)
    if (Number.isFinite(n) && n > 0) configured = n
  } catch {
    /* settings unavailable: keep the safe default */
  }
  return Math.min(configured, HARD_LINK_MAX_TTL_SECONDS)
}

/** Keys are `<tenantId>/<folder>/<file>`; refuse anything that could leave the tenant's prefix. */
export function assertLinkableKey(tenantId: string, key: string): void {
  const ok =
    typeof key === 'string' &&
    key.length > 0 &&
    key.length <= 1024 &&
    key.startsWith(`${tenantId}/`) &&
    !key.includes('\\') &&
    !key.includes('\0') &&
    !key.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')
  if (!ok) throw new AppError(STORAGE_MESSAGES.LINK_INVALID_KEY, 422, ErrorCode.VALIDATION_ERROR)
}

/**
 * The scan verdict stored on `uploaded_files` for this key. `infected`, `error`
 * and `pending` (async scan not finished) are not downloadable. A key with no
 * audit row is allowed only when the tenant does not scan (storage.03).
 * A browser-direct upload's staging key is never downloadable: those bytes have
 * not been checked, and the checked copy lives under its final key.
 */
export async function isObjectDownloadable(tenantId: string, key: string): Promise<boolean> {
  if (isStagingKey(key)) return false
  try {
    const row = await withTenantRepositoryFor(tenantId, UploadedFile, (repo) =>
      repo.findOne({ where: { tenantId, key, deletedAt: IsNull() }, order: { createdAt: 'DESC' } }),
    )
    // storage.03: a key with no audit row is served only while the tenant does not scan (there is no verdict to
    // enforce); with scanning on, a missing verdict is not a clean one. An `error` verdict (scanner outage, timeout,
    // quota) is a scan that did not happen: not served (fail closed) until a rescan says clean.
    if (!row) {
      const { getScanConfig } = await import('./storage.scanner-factory')
      return !(await getScanConfig(tenantId)).enabled
    }
    return row.scanStatus !== 'infected' && row.scanStatus !== 'pending' && row.scanStatus !== 'error'
  } catch (error) {
    // Fail closed: an unreadable verdict must not become a download.
    Logger.warn(`storage.links scan verdict lookup failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/** Create a link. Returns the absolute URL of `GET /api/storage/links/<token>` for the tenant. */
export async function createDownloadLink(
  tenantId: string,
  key: string,
  opts: CreateDownloadLinkOptions,
): Promise<CreatedDownloadLink> {
  assertLinkableKey(tenantId, key)
  if (!(await isObjectDownloadable(tenantId, key))) {
    throw new AppError(STORAGE_MESSAGES.LINK_OBJECT_UNAVAILABLE, 422, ErrorCode.VALIDATION_ERROR)
  }

  const maxTtl = await getLinkMaxTtlSeconds()
  const ttl = Math.min(Math.max(Math.floor(opts.ttlSeconds) || 1, 1), maxTtl)
  const now = Date.now()
  const expiresAt = now + ttl * 1000

  const token = randomBytes(32).toString('base64url')
  const hash = hashToken(token)
  const record: DownloadLinkRecord = {
    tenantId,
    key,
    expiresAt,
    singleUse: opts.singleUse === true,
    audience: opts.audience || undefined,
    purpose: opts.purpose,
    filename: opts.filename,
    contentType: opts.contentType,
    redirectAllowed: opts.redirectAllowed !== false,
    createdAt: now,
  }

  await redis.set(linkKey(hash), JSON.stringify(record), 'EX', ttl, 'NX')
  await redis.zadd(indexKey(tenantId), expiresAt, hash)
  // The index lives at most as long as the longest possible link.
  await redis.expire(indexKey(tenantId), maxTtl + 60)

  return { url: await buildLinkUrl(tenantId, token, opts.audience), expiresAt: new Date(expiresAt), linkId: hash }
}

/**
 * Absolute URL (the device is outside the app): the tenant's own verified
 * domain when one serves (common's `absoluteTenantUrl`, through the
 * `common:tenant_origin` point), otherwise the platform host with the explicit
 * tenant path.
 */
async function buildLinkUrl(tenantId: string, token: string, audience?: string): Promise<string> {
  const base = await absoluteTenantUrl(tenantId, `/api/storage/links/${token}`)
  return audience ? `${base}?aud=${encodeURIComponent(audience)}` : base
}

/** Look a link up by its token. Unknown, expired or malformed → null (callers never distinguish). */
export async function resolveDownloadLink(token: string): Promise<{ hash: string; record: DownloadLinkRecord } | null> {
  if (!token || token.length > 200) return null
  const hash = hashToken(token)
  const raw = await redis.get(linkKey(hash))
  if (!raw) return null
  try {
    const record = JSON.parse(raw) as DownloadLinkRecord
    if (record.expiresAt <= Date.now()) return null
    return { hash, record }
  } catch {
    return null
  }
}

/**
 * Single-use claim. The FIRST client fingerprint (audience, else IP) to fetch
 * wins the link for its remaining lifetime; the same fingerprint may resume
 * (ranged re-requests), any other gets refused. Documented trade-off: a device
 * that changes IP mid-download needs `audience` (OTA uses audience by default).
 */
export async function claimSingleUse(hash: string, record: DownloadLinkRecord, fingerprint: string): Promise<boolean> {
  const remaining = Math.max(1, Math.ceil((record.expiresAt - Date.now()) / 1000))
  const set = await redis.set(claimKey(hash), fingerprint, 'EX', remaining, 'NX')
  if (set === 'OK') return true
  return (await redis.get(claimKey(hash))) === fingerprint
}

/** Revoke a link. Returns whether it existed. Tenant-checked: a linkId of another tenant is a no-op. */
export async function revokeDownloadLink(tenantId: string, linkId: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(linkId)) return false
  const raw = await redis.get(linkKey(linkId))
  if (raw) {
    try {
      if ((JSON.parse(raw) as DownloadLinkRecord).tenantId !== tenantId) return false
    } catch {
      return false
    }
  }
  await redis.del(linkKey(linkId), claimKey(linkId))
  const removed = await redis.zrem(indexKey(tenantId), linkId)
  return Boolean(raw) || removed > 0
}

export interface DownloadLinkSummary {
  linkId: string
  key: string
  purpose: string
  audience?: string
  singleUse: boolean
  expiresAt: Date
  createdAt: Date
}

/** Active links of a tenant, optionally filtered by `purpose`. */
export async function listDownloadLinks(
  tenantId: string,
  filter: { purpose?: string } = {},
): Promise<DownloadLinkSummary[]> {
  const now = Date.now()
  await redis.zremrangebyscore(indexKey(tenantId), '-inf', now)
  const hashes = await redis.zrange(indexKey(tenantId), 0, 499)
  if (hashes.length === 0) return []
  const raws = await redis.mget(...hashes.map(linkKey))
  const out: DownloadLinkSummary[] = []
  hashes.forEach((hash, i) => {
    const raw = raws[i]
    if (!raw) return
    try {
      const r = JSON.parse(raw) as DownloadLinkRecord
      if (r.tenantId !== tenantId || r.expiresAt <= now) return
      if (filter.purpose && r.purpose !== filter.purpose) return
      out.push({
        linkId: hash,
        key: r.key,
        purpose: r.purpose,
        audience: r.audience,
        singleUse: r.singleUse,
        expiresAt: new Date(r.expiresAt),
        createdAt: new Date(r.createdAt),
      })
    } catch {
      /* skip a corrupt record */
    }
  })
  return out
}
