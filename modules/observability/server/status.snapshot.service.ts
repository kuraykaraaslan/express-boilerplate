import 'reflect-metadata'
import { createHash } from 'node:crypto'
import Logger from '@kuraykaraaslan-labs/logger'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import StatusPageService, { type StatusPageSpec } from './status.page.service'
import StatusPublicService, { type PublicPage } from './status.public.service'
import { buildSnapshotHtml } from './status.static.html'
import { normalizeLocale } from './status.page.rules'

/**
 * The static snapshot of a public status page (observability phase 15.9): the part of the status page that does not need this
 * application, its database or its network path to be up.
 *
 * What it is. For each language a page offers, an HTML file and a JSON file, written to the tenant's storage at a STABLE key
 * (`<tenant>/status/snapshots/<slug>[.<lang>].html|json`) and overwritten in place. They are published on every state change (when this
 * process runs the boot task) and on a heartbeat, so a tenant whose application is gone still has a page, and the page says when it was
 * last refreshed and warns once it is older than the staleness bound.
 *
 * What it is built from. ONLY `StatusPublicService.buildPublicPage`, the one allowlist serializer, for a PUBLIC page. The renderers see a
 * `PublicPage` and nothing else, so the snapshot cannot say anything the live public page does not. A page that is not PUBLIC has no
 * snapshot, ever: its answer depends on who asks, and a static file cannot ask.
 *
 * What it must also do. A page that stops being public (switched off, audience changed, deleted, snapshot turned off, or the tenant
 * switched status pages off) must disappear from storage, or "disabled equals nonexistent" would be false at the second origin. Retraction
 * deletes exactly the files the last publish wrote.
 *
 * What it does not do. It does not serve anything: a second origin does (docs/adr/0010). It does not make the file public: the bucket or
 * the CDN in front of it does.
 */

export const SNAPSHOT_FOLDER = 'status/snapshots'
/** The page warns once its data is this old. The heartbeat is more than three times as frequent, so a warning means something is wrong. */
export const SNAPSHOT_STALE_AFTER_SECONDS = 15 * 60
/** A snapshot whose content did not change is still rewritten after this long, so the staleness bound keeps meaning "last confirmed". */
export const SNAPSHOT_REFRESH_AFTER_SECONDS = 4 * 60

export type SnapshotState = 'published' | 'unchanged' | 'failed' | 'disabled'
export interface SnapshotResult { slug: string; state: SnapshotState; files?: string[]; url?: string | null; error?: string }

export interface SnapshotFile { name: string; contentType: string; body: string }
export interface BuiltSnapshot { files: SnapshotFile[]; hash: string; generatedAt: string }

const lang = (l: string) => normalizeLocale(l).replace(/[^a-z0-9-]/g, '')

/** The file names of one language. The primary language owns the plain name; the others add their code. */
export function snapshotNames(slug: string, language: string, primary: string): { html: string; json: string } {
  const base = lang(language) === lang(primary) ? slug : `${slug}.${lang(language)}`
  return { html: `${base}.html`, json: `${base}.json` }
}

export function snapshotKey(tenantId: string, name: string): string {
  return `${tenantId}/${SNAPSHOT_FOLDER}/${name}`
}

/** A hash of what a visitor would read, without the moment it was generated (so an unchanged page hashes the same on every run). */
export function contentHash(pages: readonly PublicPage[]): string {
  const h = createHash('sha256')
  for (const p of pages) h.update(JSON.stringify({ ...p, generatedAt: '' }))
  return h.digest('hex')
}

/** Short, secret-free text for the admin screen. */
function reason(err: unknown): string {
  const name = err instanceof Error ? err.name : 'Error'
  const msg = err instanceof Error ? err.message : String(err)
  return `${name}: ${msg}`.replace(/\s+/g, ' ').slice(0, 250)
}

export default class StatusSnapshotService {
  /**
   * Build the files of a page. Throws for a page that is not public and on (the caller decides whether that means "retract").
   * Every language the page offers gets its own pair, each built by the one serializer.
   */
  static async build(tenantId: string, page: StatusPageSpec, now: Date = new Date()): Promise<BuiltSnapshot> {
    if (!page.enabled || page.audience !== 'PUBLIC') throw new AppError('Only a public page has a snapshot', 409, ErrorCode.CONFLICT)
    const primaryPage = await StatusPublicService.buildPublicPage(tenantId, page, { now })
    const { primary, available } = primaryPage.language
    const pages: PublicPage[] = [primaryPage]
    for (const l of available) {
      if (lang(l) === lang(primary)) continue
      pages.push(await StatusPublicService.buildPublicPage(tenantId, page, { language: l, now }))
    }
    const generatedAt = now.toISOString()
    const staleAfter = new Date(now.getTime() + SNAPSHOT_STALE_AFTER_SECONDS * 1000).toISOString()
    const links = pages.map((p) => ({ language: p.language.served, href: snapshotNames(page.slug, p.language.served, primary).html }))
    const files: SnapshotFile[] = []
    for (const p of pages) {
      const names = snapshotNames(page.slug, p.language.served, primary)
      files.push({
        name: names.json, contentType: 'application/json',
        body: JSON.stringify({ ...p, snapshot: { generatedAt, staleAfterSeconds: SNAPSHOT_STALE_AFTER_SECONDS, staleAfter } }),
      })
      files.push({
        name: names.html, contentType: 'text/html; charset=utf-8',
        body: buildSnapshotHtml(p, { generatedAt, staleAfterSeconds: SNAPSHOT_STALE_AFTER_SECONDS, languageLinks: links }),
      })
    }
    return { files, hash: contentHash(pages), generatedAt }
  }

  private static async storageFor(tenantId: string) {
    const { ifActive } = await import('@kuraykaraaslan-labs/common/server/extensions/optional-module')
    const mod = await ifActive(tenantId, 'storage', () => import('@kuraykaraaslan-labs/storage/server/storage.service'))
    if (!mod) return null
    const { registerStorageFolder } = await import('@kuraykaraaslan-labs/storage/server/storage.folders')
    registerStorageFolder(SNAPSHOT_FOLDER)
    return mod.default
  }

  /** Publish one page (or leave it, when nothing changed and it was refreshed recently). Never throws: the outcome is the result. */
  static async publishPage(tenantId: string, page: StatusPageSpec, opts: { force?: boolean; now?: Date } = {}): Promise<SnapshotResult> {
    const now = opts.now ?? new Date()
    if (!page.snapshotEnabled) return { slug: page.slug, state: 'disabled' }
    try {
      const storage = await StatusSnapshotService.storageFor(tenantId)
      if (!storage) throw new AppError('Storage is not available for this tenant', 409, ErrorCode.FEATURE_NOT_AVAILABLE)
      const built = await StatusSnapshotService.build(tenantId, page, now)
      const row = await StatusPageService.rowFor(tenantId, page)
      const fresh = row?.snapshotAt && now.getTime() - new Date(row.snapshotAt).getTime() < SNAPSHOT_REFRESH_AFTER_SECONDS * 1000
      if (!opts.force && row?.snapshotHash === built.hash && fresh && !row.snapshotError) {
        return { slug: page.slug, state: 'unchanged', files: row.snapshotFiles ?? [] }
      }
      let primaryUrl: string | null = null
      for (const f of built.files) {
        const put = await storage.putStaticObject(tenantId, { buffer: Buffer.from(f.body, 'utf8'), filename: f.name, contentType: f.contentType, folder: SNAPSHOT_FOLDER })
        if (f.name === `${page.slug}.html`) primaryUrl = put.url
      }
      const names = built.files.map((f) => f.name)
      // A language that is no longer offered must not linger at the second origin.
      for (const old of row?.snapshotFiles ?? []) {
        if (names.includes(old)) continue
        await storage.deleteFile(tenantId, { key: snapshotKey(tenantId, old) }).catch(() => undefined)
      }
      await StatusPageService.recordSnapshot(tenantId, page, { snapshotAt: now, snapshotHash: built.hash, snapshotFiles: names, snapshotError: null })
      return { slug: page.slug, state: 'published', files: names, url: primaryUrl }
    } catch (err) {
      const message = reason(err)
      Logger.warn(`[observability] status snapshot of "${page.slug}" failed for ${tenantId}: ${message}`)
      // The error is kept next to the last good publish: a failure must not erase what is still being served.
      const row = await StatusPageService.rowFor(tenantId, page).catch(() => null)
      await StatusPageService.recordSnapshot(tenantId, page, {
        snapshotAt: row?.snapshotAt ?? null, snapshotHash: row?.snapshotHash ?? null, snapshotFiles: row?.snapshotFiles ?? null, snapshotError: message,
      }).catch(() => undefined)
      return { slug: page.slug, state: 'failed', error: message }
    }
  }

  /** Remove what the last publish wrote and forget it. A page with nothing published is left alone. */
  static async retract(tenantId: string, page: Pick<StatusPageSpec, 'slug' | 'pageId' | 'isDefault'>, files: readonly string[]): Promise<void> {
    if (files.length === 0) return
    const storage = await StatusSnapshotService.storageFor(tenantId).catch(() => null)
    if (!storage) return
    for (const name of files) await storage.deleteFile(tenantId, { key: snapshotKey(tenantId, name) }).catch((e: unknown) => Logger.warn(`[observability] snapshot retract of ${name} failed: ${reason(e)}`))
    const row = await StatusPageService.rowFor(tenantId, page as StatusPageSpec)
    if (row) await StatusPageService.recordSnapshot(tenantId, page as StatusPageSpec, { snapshotAt: null, snapshotHash: null, snapshotFiles: null, snapshotError: null })
  }

  /**
   * Bring every snapshot of a tenant in line with what is public now: publish the eligible pages, retract the ones that are not eligible
   * any more (including all of them when the tenant has switched status pages off).
   */
  static async publishTenant(tenantId: string, opts: { force?: boolean; now?: Date } = {}): Promise<SnapshotResult[]> {
    const results: SnapshotResult[] = []
    const enabled = await StatusPublicService.isEnabled(tenantId)
    const eligible = enabled ? await StatusPageService.listSnapshotPages(tenantId) : []
    const eligibleSlugs = new Set(eligible.map((p) => p.slug))
    for (const page of eligible) results.push(await StatusSnapshotService.publishPage(tenantId, page, opts))
    for (const row of await StatusPageService.listRows(tenantId)) {
      if (eligibleSlugs.has(row.slug) || !row.snapshotFiles || row.snapshotFiles.length === 0) continue
      await StatusSnapshotService.retract(tenantId, { slug: row.slug, pageId: row.pageId, isDefault: row.isDefault }, row.snapshotFiles)
      results.push({ slug: row.slug, state: 'disabled' })
    }
    return results
  }

  /** The admin's "publish now" for one page (by id or the `default` alias). */
  static async publishNow(tenantId: string, pageId: string): Promise<SnapshotResult> {
    await StatusPublicService.assertEnabled(tenantId).catch(() => {
      throw new AppError('Status pages are not switched on for this workspace', 409, ErrorCode.CONFLICT)
    })
    const view = await StatusPageService.getView(tenantId, pageId)
    const page = await StatusPageService.resolve(tenantId, view.slug)
    if (!page) throw new AppError('Status page not found', 404, ErrorCode.NOT_FOUND)
    if (page.audience !== 'PUBLIC' || !page.enabled) throw new AppError('Only a public page has a snapshot', 409, ErrorCode.CONFLICT)
    if (!page.snapshotEnabled) throw new AppError('Snapshots are switched off for this page', 409, ErrorCode.CONFLICT)
    return StatusSnapshotService.publishPage(tenantId, page, { force: true })
  }
}
