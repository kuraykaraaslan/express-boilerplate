import type { NextRequest } from 'next/server'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import type { SubjectSource } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.attributes'
import DashboardCardOverlayService from './card-overlay.service'
import type { CardSubject } from './card-overlay'
import { getEmbedHosts } from './embed-hosts'
import { commandCatalogFor, type CommandCatalog } from './command-catalog'
import { aliasMembersReader, type AliasMembers } from './alias-members'
import { selectableEntityParams, type BoardParam } from './board-params'
import type { BoardPage } from './board-pages'
import {
  requestSceneGate, resolveSceneNeeds, sceneNeedsOf, scenePageSubjects, sceneParamValues, type SceneAnswerEntry, type SceneCard, type SceneWidgetInfo,
} from './scene-binding.open'
import { appLocaleOf } from './board-template.locale'

/**
 * What a board view asks for with its board when it opens (phase 40, D40-12): `GET …/boards/[boardId]?include=…`. Each part is
 * what the route a view would otherwise call for it answers, so a view sends one request where it sent one per part; the page's
 * cards still go in their own batch. The separate routes stay for later reads (a reload, a search, a subject's overlays).
 */
export const BOARD_OPEN_PARTS = ['overlays', 'commands', 'embedHosts', 'aliasEntities', 'scenes'] as const
export type BoardOpenPart = (typeof BOARD_OPEN_PARTS)[number]

/** The parts answered, each in its route's own shape. A part the caller may not read, or that failed, is absent. */
export interface BoardOpenIncluded {
  /** `GET …/boards/[boardId]/overlays` without a subject: every subject that has an overlay on the board (phase 38). */
  overlays?: { subjects: CardSubject[] }
  /** `GET …/dashboard/commands`. */
  commands?: CommandCatalog
  /** `GET …/dashboard/embed-hosts`. */
  embedHosts?: { hosts: string[] }
  /**
   * `POST …/boards/[boardId]/aliases/[aliasKey]/entities` with no params and no search, for each alias the toolbar select offers:
   * the lists of the board's own defaults. An alias whose entities the caller may not read is left out.
   */
  aliasEntities?: Record<string, AliasMembers>
  /**
   * What `GET …/dashboard/scene-bindings/resolve` answers for each (subject, slot, kind) the page's cards draw (phase 42, D42-5): the
   * subject of every page for the viewer's `p.<key>` of the request over the board's defaults, the slot of the card and the kind its
   * widget declares. One answer per distinct triple; a subject or kind the caller may not read answers `card-default`.
   */
  scenes?: { answers: SceneAnswerEntry[] }
}

/** How many alias lists are read at once (the batch route's way: a board can have 32 aliases). */
const ALIAS_LISTS_AT_ONCE = 4

/** The known part names in `include` (comma separated); anything else is ignored. */
export function parseBoardOpenParts(raw: string | null): Set<BoardOpenPart> {
  const known = new Set<string>(BOARD_OPEN_PARTS)
  return new Set((raw ?? '').slice(0, 200).split(',').map((s) => s.trim()).filter((s): s is BoardOpenPart => known.has(s)))
}

/**
 * The parts asked for, for a caller who passed the board route's own checks: `dashboard.boards.read` and the board read under
 * the caller's visibility, which is all the overlays and embed-hosts routes check. The commands part takes the caller's answer
 * for `dashboard.commands.execute` in `granted`, asked the way the commands route asks it; the alias lists ask the members
 * route's own gate (`dashboard.query.execute`) and each alias's entity type its read permission. The parts are read side by
 * side; a refusal or a failure leaves its part out, never the board (the view then asks that part's route).
 */
export async function boardOpenIncluded(args: {
  request: NextRequest
  tenantId: string
  boardId: string
  /** The board's parameters as read for this request: no entity the toolbar offers means no list to read and no gate to ask. */
  params: readonly BoardParam[]
  session: SubjectSource
  granted: ReadonlySet<string>
  parts: ReadonlySet<BoardOpenPart>
  /** The board's pages and the cards on it with their resolved widgets: what the scenes part reads (read late, the route resolves them side by side). */
  cards?: () => Promise<{ pages: ReadonlyArray<Pick<BoardPage, 'key' | 'hidden' | 'inputs'>> | null | undefined; cards: ReadonlyArray<SceneCard>; widgets: ReadonlyMap<string, SceneWidgetInfo> }>
}): Promise<BoardOpenIncluded> {
  const { request, tenantId, boardId, parts } = args
  const part = async <K extends BoardOpenPart>(key: K, read: () => Promise<NonNullable<BoardOpenIncluded[K]>>) => {
    if (!parts.has(key)) return null
    try {
      return [key, await read()] as const
    } catch {
      return null
    }
  }
  const answered = await Promise.all([
    part('overlays', async () => ({ subjects: await DashboardCardOverlayService.subjectsOnBoard(tenantId, boardId) })),
    part('commands', () => commandCatalogFor(request, tenantId, args.session, args.granted)),
    part('embedHosts', async () => ({ hosts: await getEmbedHosts(tenantId) })),
    part('aliasEntities', () => aliasListsOf(request, tenantId, boardId, args.params)),
    part('scenes', async () => {
      const placed = await args.cards?.()
      if (!placed) return { answers: [] }
      const values = sceneParamValues(args.params, request.nextUrl.searchParams)
      const needs = sceneNeedsOf({
        pageSubjects: scenePageSubjects(placed.pages, args.params, values, true), cards: placed.cards, widgets: (ref) => placed.widgets.get(ref),
      })
      return { answers: await resolveSceneNeeds(tenantId, needs, requestSceneGate(request, tenantId, args.session, await appLocaleOf(request, tenantId))) }
    }),
  ])
  return Object.fromEntries(answered.filter((a) => a !== null)) as BoardOpenIncluded
}

/** Each offered entity parameter's list as the members route answers it with no params and no search; one it refuses is left out. */
async function aliasListsOf(request: NextRequest, tenantId: string, boardId: string, params: readonly BoardParam[]): Promise<Record<string, AliasMembers>> {
  if (selectableEntityParams(params).length === 0) return {}
  const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT' })
  const reader = await aliasMembersReader(request, tenantId, auth.user.userId, boardId)
  const offered = selectableEntityParams(reader.params)
  const lists: Array<readonly [string, AliasMembers] | null> = new Array(offered.length).fill(null)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(ALIAS_LISTS_AT_ONCE, offered.length) }, async () => {
    while (next < offered.length) {
      const i = next++
      try {
        lists[i] = [offered[i].key, await reader.members(offered[i].key)] as const
      } catch {
        // its type's permission, a module that is off, a failing source: the toolbar asks the members route, which says why
      }
    }
  }))
  return Object.fromEntries(lists.filter((l) => l !== null))
}
