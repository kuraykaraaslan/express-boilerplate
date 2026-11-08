import { AppError } from '@kuraykaraaslan-labs/common/server/app-error'
import DashboardCardOverlayService from './card-overlay.service'
import { selectEntityType } from './entity-types'
import { pageSubject, subjectKey, type CardSubject } from './card-overlay'
/** A board parameter as the subject rule reads it: its key and the entity type it names (both kinds, phase 41). */
type SubjectParam = { key: string; entityType?: string }
import type { BoardPage } from './board-pages'

/** A card overlay as a screen applies it: a merge patch on the card's settings, and the card's title for the page's subject. */
export interface DisplayOverlay {
  settings: Record<string, unknown>
  title: string | null
}

/**
 * The card overlays a display link's screen applies (phase 38, 38.2.4b). A screen runs on the board's defaults, so each page it can show
 * (the menu pages; the main page has no inputs, a hidden page is never shown) shows one fixed subject: its first entity input's default
 * (`pageSubject`). A card on such a page that was customised for that subject (a station's own diagram) draws with its overlay, exactly
 * as on the board.
 *
 * The rows are read first (one tenant-scoped read per subject, none for a board whose pages show no subject), and only a subject that has
 * any is checked: its entity type must still be contributed and the issuer must hold the type's read permission through the display
 * (`authorize`). A subject that fails either check is skipped, so its cards show the board's own settings and the screen keeps running:
 * the refusal is about one item's data, not about the link. Returns the overlay per card id.
 */
export async function displayOverlays(args: {
  tenantId: string
  boardId: string
  pages: ReadonlyArray<Pick<BoardPage, 'key' | 'hidden' | 'inputs'>> | null | undefined
  params: ReadonlyArray<SubjectParam> | null | undefined
  values: Readonly<Record<string, unknown>>
  cards: ReadonlyArray<{ instanceId: string; pageKey?: string | null }>
  authorize: (permission: string) => Promise<void>
}): Promise<Map<string, DisplayOverlay>> {
  const subjectOfPage = new Map<string, CardSubject>()
  for (const page of args.pages ?? []) {
    if (page.hidden) continue
    const subject = pageSubject(args.pages, page.key, args.params, args.values)
    if (subject) subjectOfPage.set(page.key, subject)
  }
  const out = new Map<string, DisplayOverlay>()
  if (subjectOfPage.size === 0) return out

  const bySubject = new Map<string, Map<string, DisplayOverlay>>()
  for (const subject of subjectOfPage.values()) {
    const key = subjectKey(subject)
    if (bySubject.has(key)) continue
    const rows = await DashboardCardOverlayService.listForSubject(args.tenantId, args.boardId, subject)
    const readable = rows.length > 0 && await subjectReadable(args.tenantId, subject, args.authorize)
    bySubject.set(key, new Map(readable ? rows.map((r) => [r.instanceId, { settings: r.settings ?? {}, title: r.title ?? null }]) : []))
  }
  for (const card of args.cards) {
    const subject = card.pageKey ? subjectOfPage.get(card.pageKey) : undefined
    const overlay = subject ? bySubject.get(subjectKey(subject))?.get(card.instanceId) : undefined
    if (overlay) out.set(card.instanceId, overlay)
  }
  return out
}

/** The issuer may read the subject's type through the display: false for a type no longer contributed (404) or a refusal (403). */
async function subjectReadable(tenantId: string, subject: CardSubject, authorize: (permission: string) => Promise<void>): Promise<boolean> {
  try {
    const type = await selectEntityType(tenantId, subject.type)
    await authorize(type.requiredPermission)
    return true
  } catch (e) {
    if (e instanceof AppError && (e.statusCode === 403 || e.statusCode === 404)) return false
    throw e
  }
}
