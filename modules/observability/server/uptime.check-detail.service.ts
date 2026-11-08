import 'reflect-metadata'
import { createHash } from 'node:crypto'
import { In, IsNull, LessThan, Not } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { MonitorCheckDetail } from './entities/monitor_check_detail.entity'
import { MAX_SCREENSHOT_BYTES, parseBrowserDetail, type BrowserDetail } from './uptime.browser.schema'

/**
 * What a BROWSER sample carries beyond the sample (D-OBS-8): the bounded run record and one capped failure screenshot.
 *
 * WHERE THE SCREENSHOT LIVES, and why (decided with the phase): in the tenant's own database row next to the sample (`monitor_check_details.screenshot`, bytea), NOT in the
 * `storage` module and NOT as a hash only.
 *  - **Retention is one statement.** The picture goes with the raw check it belongs to: the retention pass deletes the detail rows with the same cutoff, in the same database,
 *    so a picture can never outlive its sample or the tenant's retention setting. Storage objects would need a delete call per row against an external bucket, and a failed
 *    call leaves an orphan nobody counts.
 *  - **Isolation is the database's.** The row is tenant-partitioned with the same RLS policy as every other row and is read only through the screenshot route, behind its own
 *    permission. A bucket object is addressed by a URL that lives outside the permission model (public-read buckets, long-lived presigned links), and a failure screenshot of a
 *    login page is exactly what must not be one link away.
 *  - **It works on every workspace.** `storage` is optional and tenant-configured; a feature that quietly stores nothing when it is absent would fail exactly when someone needs the picture.
 *  - **The cost is bounded, so it is accepted.** At most 300 KB per picture (the runner downscales to JPEG and drops what does not fit), only on a failed run, and at most
 *    `MAX_SCREENSHOTS_PER_MONITOR` pictures kept per monitor (older ones lose the bytes, not the record): ~9 MB per monitor worst case, bytes never selected by a list query.
 * Holding only a hash and the step name stays the fallback when the runner could not produce a picture that fits.
 */
export const MAX_SCREENSHOTS_PER_MONITOR = 30

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

export interface PreparedBrowserResult {
  detail: BrowserDetail
  screenshot: { bytes: Buffer; sha256: string; step: string } | null
}

/** Decode and verify a screenshot: strict base64, at most 300 KB, a real JPEG envelope. Returns null for anything else (the sample is kept without a picture). */
export function decodeScreenshot(base64: string): Buffer | null {
  if (!base64 || base64.length > Math.ceil(MAX_SCREENSHOT_BYTES * 4 / 3) + 8 || base64.length % 4 !== 0 || !BASE64.test(base64)) return null
  const bytes = Buffer.from(base64, 'base64')
  if (bytes.length < 4 || bytes.length > MAX_SCREENSHOT_BYTES) return null
  // JPEG: starts FF D8 FF, ends FF D9. Nothing is decoded here (the control plane never runs an image decoder on bytes a runner sent); the route serves it as image/jpeg with nosniff.
  if (!(bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9)) return null
  return bytes
}

export default class CheckDetailService {
  /** Pure: bound and verify what a runner sent. A screenshot is kept only for a failed run and only when its bytes match what the record says. */
  static prepare(raw: { detail: unknown; screenshotJpegBase64?: string }, status: string): PreparedBrowserResult | null {
    const detail = parseBrowserDetail(raw.detail)
    if (!detail) return null
    let screenshot: PreparedBrowserResult['screenshot'] = null
    if (status !== 'UP' && raw.screenshotJpegBase64) {
      const bytes = decodeScreenshot(raw.screenshotJpegBase64)
      if (bytes) {
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        if (!detail.screenshot || detail.screenshot.sha256 === sha256) screenshot = { bytes, sha256, step: (detail.screenshot?.step ?? 'unknown').slice(0, 60) }
      }
    }
    // The record must not claim a picture that was not stored.
    const clean: BrowserDetail = screenshot ? { ...detail, screenshot: { ...(detail.screenshot ?? { width: 1, height: 1 }), step: screenshot.step, bytes: screenshot.bytes.length, sha256: screenshot.sha256 } } : { ...detail, screenshot: undefined }
    return { detail: clean, screenshot }
  }

  static async store(tenantId: string, monitorId: string, checkId: string, checkedAt: Date, prepared: PreparedBrowserResult, locationKey: string | null = null): Promise<void> {
    await withTenantRepositoryFor(tenantId, MonitorCheckDetail, (repo) => repo.save(repo.create({
      checkId, tenantId, monitorId, checkedAt, locationKey, detail: prepared.detail as unknown as Record<string, unknown>,
      screenshot: prepared.screenshot?.bytes ?? null, screenshotBytes: prepared.screenshot?.bytes.length ?? null,
      screenshotSha256: prepared.screenshot?.sha256 ?? null, screenshotStep: prepared.screenshot?.step ?? null,
    })))
    if (prepared.screenshot) await CheckDetailService.trimScreenshots(tenantId, monitorId)
  }

  /** Keep the newest `MAX_SCREENSHOTS_PER_MONITOR` pictures of a monitor; older ones lose their bytes (the record stays until retention). */
  static async trimScreenshots(tenantId: string, monitorId: string): Promise<void> {
    await withTenantRepositoryFor(tenantId, MonitorCheckDetail, async (repo) => {
      const old = await repo.find({
        where: { tenantId, monitorId, screenshotBytes: Not(IsNull()) }, select: { checkId: true }, order: { checkedAt: 'DESC' }, skip: MAX_SCREENSHOTS_PER_MONITOR, take: 200,
      })
      if (old.length) await repo.update({ tenantId, monitorId, checkId: In(old.map((o) => o.checkId)) }, { screenshot: null, screenshotBytes: null, screenshotSha256: null, screenshotStep: null })
    })
  }

  /** The detail of a list of samples, keyed by sample id. `hasScreenshot` is what a list needs; the bytes are never selected here. */
  static async forChecks(tenantId: string, monitorId: string, checkIds: string[]): Promise<Map<string, { detail: BrowserDetail; hasScreenshot: boolean }>> {
    if (checkIds.length === 0) return new Map()
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheckDetail, (repo) => repo.find({
      where: { tenantId, monitorId, checkId: In(checkIds) },
      select: { checkId: true, detail: true, screenshotBytes: true },
    }))
    return new Map(rows.map((r) => [r.checkId, { detail: r.detail as unknown as BrowserDetail, hasScreenshot: (r.screenshotBytes ?? 0) > 0 }]))
  }

  /** One sample's screenshot, for the route. Tenant and monitor are part of the lookup; anything else is the same 404. */
  static async screenshot(tenantId: string, monitorId: string, checkId: string): Promise<{ bytes: Buffer; sha256: string; step: string | null }> {
    const row = await withTenantRepositoryFor(tenantId, MonitorCheckDetail, (repo) => repo.findOne({
      where: { tenantId, monitorId, checkId }, select: { checkId: true, screenshot: true, screenshotSha256: true, screenshotStep: true, screenshotBytes: true },
    }))
    if (!row || !row.screenshot || !row.screenshotSha256) throw new AppError('Screenshot not found', 404, ErrorCode.NOT_FOUND)
    return { bytes: Buffer.from(row.screenshot), sha256: row.screenshotSha256, step: row.screenshotStep ?? null }
  }

  /** Retention: the details go with the raw checks, on the same cutoff. Returns how many rows were removed. */
  static async prune(tenantId: string, cutoff: Date): Promise<number> {
    const r = await withTenantRepositoryFor(tenantId, MonitorCheckDetail, (repo) => repo.delete({ tenantId, checkedAt: LessThan(cutoff) }))
    return r.affected ?? 0
  }
}
