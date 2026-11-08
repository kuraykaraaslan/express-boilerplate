import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { DashboardWidgetInstance } from './entities/dashboard_widget_instance.entity'
import DashboardBoardService, { type BoardViewer } from './board.crud.service'
import { isEntityParam, normalizeBoardParams, type BoardParam } from './board-params'
import { slotOf, UUID_RE } from './scene-binding'
import type { CardSubject } from './card-overlay'

/**
 * Where a subject's view is shown (docs/phases/07-dashboard/48, 48.3): the line under the view on a device's Scene tab, "Shown on N dashboards; M keep
 * their own picture". Counted from what is STORED, over the boards the caller may open:
 *
 *  - a card that names the subject itself: its `points` slot's `device` is this device (`subjectOfDataBinding`'s rule, E2E-2.5, a device only);
 *  - a card on a page about one subject of a board that lists the subject's subtype: the board has an entity parameter of the subject's type that
 *    chooses by subtype and names this subject's (a device's profile, a site's kind), and the page's subject (its first input that names an entity
 *    parameter, `pageSubject`'s rule) is of that type. The shipped device boards are such boards (`fleet` by profile, the process page on `device`).
 *
 * A card that follows whatever device its page is opened with, on a board that names no subtype, cannot be counted from what is stored (any device of
 * the tenant may be put in its address): it is left out, never guessed. Only cards of a widget that draws the view's kind count (the descriptors the
 * caller may see); a card that keeps its own picture (`picture: 'own'`) counts as "keeps its own picture" whatever its slot, a following card only when
 * its slot is the view's (another slot draws another view). One board counts once; it keeps its own picture when one of its cards does.
 */

/** The fixed boards named in the answer: only while there are at most this many ("M keep their own picture: A, B, C"). */
export const MAX_NAMED_FIXED_BOARDS = 3
/** The most boards one count reads (a tenant's dashboards; the rest are left out of the count). */
export const MAX_COUNTED_BOARDS = 1000

export interface PlacementBoard {
  boardId: string
  title: string
  params?: unknown
  aliases?: unknown
  pages?: unknown
}

export interface PlacementCard {
  /** The board the card is on (`entityId` of a `DASHBOARD` placement). */
  boardId: string
  widgetRef: string
  pageKey?: string | null
  settings?: unknown
  dataBinding?: unknown
}

export interface ScenePlacementCount {
  /** The boards that show the subject in a card of the view's kind. */
  shown: number
  /** Of those, the boards where a card keeps its own picture. */
  fixed: number
  /** Those boards by title, only while there are at most `MAX_NAMED_FIXED_BOARDS` (else empty). */
  fixedBoards: Array<{ boardId: string; title: string }>
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** The pages of `board` about one subject of `subject.type`, when the board lists the subject's `subtype` (see above); empty otherwise. Pure. */
export function listingPagesOf(board: Pick<PlacementBoard, 'params' | 'aliases' | 'pages'>, subjectType: string, subtype: string | null): Set<string> {
  const pages = new Set<string>()
  if (!subtype) return pages
  const params: BoardParam[] = normalizeBoardParams({ params: board.params, aliases: board.aliases }).params
  const lists = params.some((p) => isEntityParam(p) && p.entityType === subjectType && p.choose.type === 'subtype' && p.choose.subtypes.includes(subtype))
  if (!lists) return pages
  for (const raw of Array.isArray(board.pages) ? board.pages : []) {
    const page = obj(raw)
    if (typeof page.key !== 'string') continue
    for (const input of Array.isArray(page.inputs) ? page.inputs : []) {
      const def = params.find((p) => p.key === obj(input).param)
      const type = def && isEntityParam(def) ? def.entityType : undefined
      if (!type) continue
      if (type === subjectType) pages.add(page.key)
      break
    }
  }
  return pages
}

/** The card names `subject` itself: a device written into its `points` slot (`subjectOfDataBinding`'s rule). Pure. */
export function cardNamesSubject(card: Pick<PlacementCard, 'dataBinding'>, subject: CardSubject): boolean {
  if (subject.type !== 'iot_device') return false
  const device = obj(obj(obj(card.dataBinding).points).params).device
  return typeof device === 'string' && UUID_RE.test(device) && device.toLowerCase() === subject.id.toLowerCase()
}

/** The count (see the file's comment). `sceneKindOf` answers the scene kind a card's widget draws for the caller (undefined: none, or not visible). Pure. */
export function countScenePlacements(a: {
  boards: readonly PlacementBoard[]
  cards: readonly PlacementCard[]
  subject: CardSubject
  subtype: string | null
  kind: string
  slot: string
  sceneKindOf: (widgetRef: string) => string | undefined
}): ScenePlacementCount {
  const boards = new Map(a.boards.map((b) => [b.boardId, b]))
  const listing = new Map<string, Set<string>>()
  const pagesOf = (b: PlacementBoard) => listing.get(b.boardId) ?? listing.set(b.boardId, listingPagesOf(b, a.subject.type, a.subtype)).get(b.boardId)!
  const shown = new Map<string, { title: string; fixed: boolean }>()
  for (const card of a.cards) {
    const board = boards.get(card.boardId)
    if (!board || a.sceneKindOf(card.widgetRef) !== a.kind) continue
    const onSubjectPage = !!card.pageKey && pagesOf(board).has(card.pageKey)
    if (!onSubjectPage && !cardNamesSubject(card, a.subject)) continue
    const settings = obj(card.settings)
    const fixed = settings.picture === 'own'
    if (!fixed && slotOf(settings) !== a.slot) continue
    const seen = shown.get(board.boardId) ?? { title: board.title, fixed: false }
    seen.fixed ||= fixed
    shown.set(board.boardId, seen)
  }
  const fixedBoards = [...shown].filter(([, s]) => s.fixed).map(([boardId, s]) => ({ boardId, title: s.title })).sort((x, y) => x.title.localeCompare(y.title))
  return { shown: shown.size, fixed: fixedBoards.length, fixedBoards: fixedBoards.length <= MAX_NAMED_FIXED_BOARDS ? fixedBoards : [] }
}

/**
 * The boards and cards the count reads, in two reads: the boards the caller may open (`DashboardBoardService.list`: shared ones and their own, a module's
 * board only while its module is on), then ONE query over the placements on them that name the subject or sit on a board that lists its subtype. Tenant
 * predicates on both; the subject's subtype is the caller's lookup (the entity type's own read).
 */
export async function readScenePlacements(
  tenantId: string, viewer: BoardViewer, subject: CardSubject, subtype: string | null, enabledIds?: Set<string>,
): Promise<{ boards: PlacementBoard[]; cards: PlacementCard[] }> {
  const all = await DashboardBoardService.list(tenantId, viewer, enabledIds ? { enabledIds } : {})
  const boards: PlacementBoard[] = all.slice(0, MAX_COUNTED_BOARDS).map((b) => ({ boardId: b.boardId, title: b.title, params: b.params, aliases: b.aliases, pages: b.pages }))
  const listing = boards.filter((b) => listingPagesOf(b, subject.type, subtype).size > 0).map((b) => b.boardId)
  const named = subject.type === 'iot_device' && UUID_RE.test(subject.id)
  if (boards.length === 0 || (listing.length === 0 && !named)) return { boards, cards: [] }
  const either = [
    ...(listing.length ? ['i."entityId" IN (:...listing)'] : []),
    ...(named ? [`lower(i."dataBinding" #>> '{points,params,device}') = :subjectId`] : []),
  ]
  const rows = await withTenantRepositoryFor(tenantId, DashboardWidgetInstance, (repo) => repo.createQueryBuilder('i')
    .select('i."entityId"', 'boardId')
    .addSelect('i."widgetRef"', 'widgetRef')
    .addSelect('i."pageKey"', 'pageKey')
    .addSelect('i."settings"', 'settings')
    .addSelect('i."dataBinding"', 'dataBinding')
    .where('i."tenantId" = :tenantId AND i."entityType" = :surface AND i."entityId" IN (:...visible)', { tenantId, surface: 'DASHBOARD', visible: boards.map((b) => b.boardId) })
    .andWhere(`(${either.join(' OR ')})`, { listing, subjectId: subject.id.toLowerCase() })
    .getRawMany<PlacementCard>())
  return { boards, cards: rows }
}
