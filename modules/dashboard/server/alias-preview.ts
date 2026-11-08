import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { aliasParamKeys, aliasRefKey, aliasSlotValue, type EntityAlias, type EntitySlot } from './board-aliases'
import { isEntityParam, type EntityParamDef } from './board-params'
import { takesFirstWhenUnset, type AliasResolver } from './alias-resolver'
import type { BoardState } from './query-gates'
import type { EntityRef } from './entity-alias.types'

/**
 * What the alias preview says besides the matches (phase 49a): the parameters a draft waits on (AD-11) and what a card of one entity
 * gets from it (AD-12), and the answer for one of the board's parameters in a card's entity slot (D112). Every rule here is the run
 * time's own (`aliasSlotValue`, the resolver), so the editor and the card say the same.
 */
export interface PreviewNotes {
  /** The labels of the parameters the draft follows that have no value on the page the editor shows (AD-11). */
  waitingFor?: string[]
  /**
   * What a card that shows one entity gets from the draft, by the run-time rule (AD-12): the entity (`first` when the draft is one
   * entity and takes the first of several by name), or how many it would have to choose from (then the card asks to pick one).
   */
  single?: { name: string; first?: boolean } | { count: number }
}

/** The labels of the parameters among `keys` that hold no entity and no value on this page. */
async function waitingOn(board: BoardState, resolver: AliasResolver, keys: Iterable<string>): Promise<string[]> {
  const out: string[] = []
  for (const key of keys) {
    const p = (board.params ?? []).find((d) => d.key === key)
    if (!p) continue
    let empty: boolean
    if (isEntityParam(p)) {
      try {
        empty = (await resolver.resolve(key)).entities.length === 0
      } catch (e) {
        if (!(e instanceof AppError && e.message.startsWith(MSG.BOARD_PARAM_UNRESOLVED))) throw e
        empty = true
      }
    } else {
      const v = board.paramValues[key]
      empty = v === undefined || v === null || v === ''
    }
    if (empty) out.push(p.label)
  }
  return out
}

/** The notes of a draft's preview (`PreviewNotes`); none for a draft that matched something and gives nothing to say. */
export async function previewNotes(
  board: BoardState,
  resolver: AliasResolver,
  draft: EntityAlias,
  param: EntityParamDef | undefined,
  found: { entities: EntityRef[]; total: number },
): Promise<PreviewNotes> {
  if (found.total === 0) {
    const waitingFor = await waitingOn(board, resolver, aliasParamKeys([draft]))
    return waitingFor.length > 0 ? { waitingFor } : {}
  }
  const first = found.entities[0]
  if (draft.resolveMultiple) return { single: found.total === 1 && first ? { name: first.name } : { count: found.total } }
  // One entity: an alias (and a parameter that says so) takes the first by name when nobody picked one (TB), the run time's own rule;
  // a parameter with a default of its own starts on that one instead (R49a-3).
  const takesFirst = takesFirstWhenUnset(param) && param?.default === undefined
  return found.total > 1 && takesFirst && first ? { single: { name: first.name, first: true } } : {}
}

/** One of the board's entity parameters as a card's entity slot takes it on this page: its entities, the refusal, or what it waits on. */
export type SlotAnswer =
  | { slot: { entities: EntityRef[] } }
  | { slot: { refusal: { message: string; details?: Record<string, unknown> } } }
  | { waitingFor: string[] }

/**
 * `filter` (R49a-2): the board filter the card's reference names (`{ $alias, filter }`), so the answer is the filtered set the card
 * resolves (`<key>|<filter>`, the run time's memo), not the whole one.
 */
export async function slotAnswer(
  board: BoardState, resolver: AliasResolver, key: string, slot: EntitySlot, filter?: string,
): Promise<SlotAnswer> {
  const param = (board.params ?? []).find((p) => p.key === key)
  if (!param || !isEntityParam(param)) throw new AppError(`${MSG.BOARD_PARAM_UNKNOWN}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
  if (filter !== undefined && !(board.filters ?? []).some((f) => f.key === filter)) {
    throw new AppError(`${MSG.FILTER_UNKNOWN}: '${filter}'`, 422, ErrorCode.VALIDATION_ERROR)
  }
  try {
    const value = await resolver.forSlot(aliasRefKey({ $alias: key, filter }), slot)
    const taken = aliasSlotValue(key, slot, value)
    const ids = Array.isArray(taken) ? taken : taken ? [taken] : []
    if (ids.length === 0) {
      // Nothing, because what it follows has no value here (a site's device on a page opened without a site): say which.
      const waitingFor = await waitingOn(board, resolver, aliasParamKeys([(await resolver.resolve(key)).alias]))
      if (waitingFor.length > 0) return { waitingFor }
    }
    const byId = new Map((value.named ?? []).map((e) => [e.id, e]))
    return { slot: { entities: ids.map((id) => byId.get(id) ?? { type: slot.entityTypes[0], id, name: id }) } }
  } catch (e) {
    if (!(e instanceof AppError) || e.statusCode !== 422) throw e
    if (e.message.startsWith(MSG.BOARD_PARAM_UNRESOLVED)) return { waitingFor: await waitingOn(board, resolver, [key]) }
    return { slot: { refusal: { message: e.message, ...(e.details ? { details: e.details } : {}) } } }
  }
}
