import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { BoardContextParamsSchema, BoardParamKeySchema } from './board-window'
import { AliasEntitiesSchema, ContributionKeySchema, EntityAliasSchema } from './board-aliases'
import { EntityParamDefSchema, entityParamAlias } from './board-params'
import { BoardFilterSchema } from './board-filters'
import { aliasResolverFor, resolveBoardState, type BoardState } from './query-gates'
import { previewNotes, slotAnswer } from './alias-preview'
import { appLocaleOf } from './board-template.locale'

/** A card's entity slot, as its query declares it (`DataSourceQueryDef.entitySlots`): what the slot answer is asked for. */
const SlotSchema = z.object({
  entityTypes: z.array(ContributionKeySchema).min(1).max(10),
  multiple: z.boolean(),
}).strict()

const PreviewDTO = z.object({
  /** The draft: an alias (the phase 36 editor) or an entity parameter (phase 41); or `key`, a parameter the board has. Exactly one. */
  alias: EntityAliasSchema.optional(),
  param: EntityParamDefSchema.optional(),
  /**
   * Phase 49a (D112, AD-12): one of the board's own entity parameters, by key, as a card's entity slot (`slot`) takes it on the page
   * the editor shows (`params`): what the card gets, or the refusal in the run time's words. Needs `boardId` and `slot`.
   */
  key: BoardParamKeySchema.optional(),
  slot: SlotSchema.optional(),
  /** A draft key filter (36.7): the preview then shows the alias's entities that pass it. */
  filter: BoardFilterSchema.optional(),
  /** R49a-2: with `key`, the board filter (by key) the card's reference names: the answer is the filtered set the card resolves. */
  boardFilter: BoardParamKeySchema.optional(),
  /** The board being edited, for an alias that reads its params (a state entity, a param root); its current values. */
  boardId: z.string().uuid().optional(),
  /** AD-11: the values the open page holds (the site it was opened with), not only the defaults. */
  params: BoardContextParamsSchema.optional(),
  /** R49a-1: the viewer's picks in the filter bar (`a.<key>`), which every card query of the page sends beside `params`. */
  aliasEntities: AliasEntitiesSchema.optional(),
}).strict()
  .refine((d) => [d.alias, d.param, d.key].filter((x) => x !== undefined).length === 1, { message: 'Exactly one of alias / param / key' })
  .refine((d) => d.key === undefined || (d.boardId !== undefined && d.slot !== undefined && d.filter === undefined), {
    message: 'A key is previewed on its board, as a slot takes it',
  })
  .refine((d) => d.slot === undefined || d.key !== undefined, { message: 'A slot is previewed for a key' })
  .refine((d) => d.boardFilter === undefined || d.key !== undefined, { message: 'A board filter is previewed for a key' })
  .refine((d) => d.aliasEntities === undefined || d.boardId !== undefined, { message: 'The picks of a page are read on its board' })

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST …/dashboard/aliases/preview — a draft alias or entity parameter resolved before it is saved (phases 36 E36-12, 41): how many entities it
 * selects and the first 20 by name, so the editor can show the matches and refuse "no entity matched" (TB). The same
 * resolver and the same entity-type permissions as a query; nothing is stored.
 *
 * Phase 49a: the board's values are the open page's (`params`, AD-11); a draft that follows a parameter with no value there says
 * which (`waitingFor`, by label) instead of an empty match; a draft says what a card of one entity gets by the run-time rule
 * (`single`, AD-12); and `key` + `slot` answer what one of the board's parameters gives a card's entity slot (`slot`, D112), in the
 * card's own words when it cannot. The page is read as a card query reads it (R49a-1, R49a-2): its values, the viewer's picks in the
 * filter bar (`aliasEntities`) and, for `key`, the board filter the card's reference names (`boardFilter`).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT' })
    const dto = PreviewDTO.parse(await request.json())
    const board: BoardState = dto.boardId
      ? await resolveBoardState(tenantId, auth.user.userId, { boardId: dto.boardId, params: dto.params, aliasEntities: dto.aliasEntities })
      : { boardWindow: null, paramValues: {} }
    const resolver = aliasResolverFor(board, {
      tenantId, locale: await appLocaleOf(request, tenantId),
      authorize: async (permission) => { await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' }) },
    })
    if (dto.key !== undefined) return NextResponse.json(await slotAnswer(board, resolver, dto.key, dto.slot!, dto.boardFilter))
    const draft = dto.param ? entityParamAlias(dto.param) : dto.alias!
    const { entities, total } = dto.filter
      ? await resolver.filtered(draft, dto.filter, { limit: 20 })
      : await resolver.members(draft, { limit: 20 })
    return NextResponse.json({
      total, entities, truncated: total > entities.length,
      ...await previewNotes(board, resolver, draft, dto.param, { entities, total }),
    })
  } catch (e) {
    return normalizeError(e)
  }
}
