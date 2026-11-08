import type { NextRequest } from 'next/server'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ext, ProviderUnavailableError, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { dashboardDataSourceLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/dashboard.data_source'
import MSG from './dashboard.messages'
import DashboardBoardService from './board.crud.service'
import { validateParams } from './data-source.validate'
import { findBoardTemplate } from './board-template.registry'
import { substituteParamRefs, effectiveWindow, type TimeWindow } from './board-window'
import { aliasSlotValue, type EntitySlot, type ResolvedAliasValue } from './board-aliases'
import {
  boardAliasKeys, entityParamOf, entityRefOf, isNarrowedPick, isPlainEntityParam, isValueParam, normalizeBoardParams, resolveBoardParamValues, withAliasEntities,
  type BoardParam,
} from './board-params'
import { createParamResolver, type AliasResolver } from './alias-resolver'
import type { BoardFilter } from './board-filters'
import { entityTypeDeps } from './entity-types'
import {
  DATA_SOURCE_POINT,
  type DashboardDataSource,
  type DataSourceContext,
  type DataSourceQueryDef,
} from './data-source.types'

/**
 * The gates in front of every bound query, shared by the executor
 * (`dashboard-query.route.ts`) and the live-ticket route
 * (`dashboard-live-ticket.route.ts`) so that "may this caller run this query"
 * has ONE implementation. A live subscription is authorised by exactly the same
 * code that authorises a one-off read: there is no second authorisation path.
 *
 *   ② the contribution must be DISCOVERABLE for this caller (its module active for
 *      the tenant) — `sourceKey` resolves in the build-time map or nothing happens
 *      (404); a source whose module is turned off or fails to load is the typed 409
 *      `ProviderUnavailable` with its reason, never a 500;
 *   ③ the QUERY's own declared permission, enforced before `execute()` / before
 *      any topic is handed out.
 *
 * Gate ① (the route's own permission) stays in each route, since each route
 * names its own.
 */
export async function authorizeQuery(args: {
  request: NextRequest
  tenantId: string
  sourceKey: string
  queryKey: string
  ctx: DataSourceContext
  /**
   * Gate ③ for a caller that is not a session: the display principal decides as the link's issuer (decision #10,
   * `display-principal.ts`). Absent = the session's own `authorizeRequest` at TENANT scope, as always.
   */
  authorize?: (permission: string) => Promise<void>
}): Promise<{ source: DashboardDataSource; def: DataSourceQueryDef }> {
  const { request, tenantId, sourceKey, queryKey, ctx } = args
  // ② discoverable for this caller.
  const source = await selectDataSource(tenantId, sourceKey)

  const def = (await source.describe(ctx)).find((d) => d.key === queryKey)
  if (!def) throw new AppError(MSG.QUERY_NOT_FOUND, 404, ErrorCode.NOT_FOUND)

  // ③ the query's own permission.
  if (args.authorize) await args.authorize(def.requiredPermission)
  else await authorizeRequest({ request, tenantId, requiredPermission: def.requiredPermission, scope: 'TENANT' })
  return { source, def }
}

/**
 * The data source a binding names, if its module is active for the tenant. A key no
 * contribution in this build has stays the 404 it always was; a known source that is
 * not available here (disabled, not entitled, failing to load) is ProviderUnavailable (409).
 */
async function selectDataSource(tenantId: string, sourceKey: string): Promise<DashboardDataSource> {
  let selected: { impl: DashboardDataSource } | null
  try {
    selected = await ext.select<DashboardDataSource>(DATA_SOURCE_POINT, tenantCtx(tenantId), dashboardDataSourceLoaders, { key: sourceKey })
  } catch (e) {
    if (e instanceof ProviderUnavailableError && e.state === 'not_installed') throw new AppError(MSG.SOURCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    throw e
  }
  if (!selected) throw new AppError(MSG.SOURCE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  return selected.impl
}

/** Board defaults under the viewer's overrides, with every parameter validated. */
export interface BoardContextInput {
  /** A real board — read under the same visibility rule as opening it. */
  boardId?: string
  /** A TRANSIENT template render (docs/phases/07-dashboard/13): defaults come from the template, nothing is stored. */
  templateKey?: string
  window?: TimeWindow
  params?: Record<string, unknown>
  /** The viewer's browser zone, for a window that names none (owner decision D-11). */
  viewerTimezone?: string
  /** The viewer's current entity per single-resolve alias (phase 36, E36-6). */
  aliasEntities?: Record<string, string>
}

/** What a board view resolves to before any query runs: window, the parameters and their values (phase 41: both kinds). */
export interface BoardState {
  boardWindow: TimeWindow | null
  /** Every parameter's effective value: a value parameter's, and an entity parameter's pick (its id or ids). */
  paramValues: Record<string, unknown>
  viewerTimezone?: string
  /** The board's (or the template's) parameters, both kinds; absent with no board. */
  params?: BoardParam[]
  /** An old alias key → the entity parameter it became (D41-7), for a stored `{ $alias }` not migrated yet. */
  aliasKeys?: Record<string, string>
  /** The board's key filters (phase 36.7). */
  filters?: BoardFilter[]
}

export async function resolveBoardState(
  tenantId: string,
  userId: string,
  boardContext: BoardContextInput | undefined,
): Promise<BoardState> {
  if (!boardContext) return { boardWindow: null, paramValues: {} }
  const viewerTimezone = boardContext.viewerTimezone
  if (boardContext.templateKey) {
    const template = await findBoardTemplate(boardContext.templateKey, tenantId)
    if (!template) throw new AppError(MSG.TEMPLATE_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
    const params = normalizeBoardParams({ params: template.params }).params
    return {
      paramValues: resolveBoardParamValues(params, withAliasEntities(params, boardContext.params, boardContext.aliasEntities)),
      boardWindow: effectiveWindow({ viewer: boardContext.window ?? null, board: template.timeWindow ?? null }),
      viewerTimezone,
      params,
    }
  }
  if (!boardContext.boardId) throw new AppError(MSG.BOARD_NOT_FOUND, 404, ErrorCode.NOT_FOUND)
  // Read normalised (`DashboardBoardService.get`): one parameter list, whatever age the row is.
  const board = await DashboardBoardService.get(tenantId, boardContext.boardId, { userId })
  const params = (board.params ?? []) as BoardParam[]
  const aliasKeys = boardAliasKeys(board)
  return {
    // An old client's alias picks (`aliasEntities`) are the entity parameters' picks.
    paramValues: resolveBoardParamValues(params, withAliasEntities(params, boardContext.params, boardContext.aliasEntities, aliasKeys)),
    boardWindow: effectiveWindow({
      viewer: boardContext.window ?? null,
      board: (board.timeWindow ?? null) as TimeWindow | null,
    }),
    viewerTimezone,
    params,
    aliasKeys,
    filters: (board.filters ?? []) as BoardFilter[],
  }
}

/**
 * One resolver per board state (phases 36, 41): the batch routes hand the same state to every placement they run, so each
 * entity parameter is resolved once per request. Keyed by the state object; the authorisation is the request's own and is
 * the same for every query of one request.
 */
const resolvers = new WeakMap<BoardState, AliasResolver>()
export function aliasResolverFor(
  state: BoardState,
  args: { tenantId: string; locale: string; authorize: (permission: string) => Promise<void> },
): AliasResolver {
  let r = resolvers.get(state)
  if (!r) {
    r = createParamResolver({
      ctx: { tenantId: args.tenantId, locale: args.locale },
      params: state.params ?? [],
      values: state.paramValues,
      filters: state.filters ?? [],
      deps: entityTypeDeps(args.tenantId, args.authorize),
    })
    resolvers.set(state, r)
  }
  return r
}

/**
 * The resolved entity parameters a query's params name in its entity slots (phase 36 E36-4, phase 41); none named = nothing
 * resolved, nothing asked. A reference in an entity slot is resolved as that slot takes it (`forSlot`: D112, a site handed to a
 * slot of devices gives what it holds), under `slotValueKey`. A reference outside an entity slot is not resolved here
 * (`prepareParams` takes its plain value or refuses it), so a binding that cannot run never reaches a module; except a narrowed
 * pick taken as a plain value (phase 41.3, `isNarrowedPick`), resolved so that one outside its set is refused before the query runs.
 */
export async function aliasValuesFor(
  def: Pick<DataSourceQueryDef, 'entitySlots'>,
  rawParams: Record<string, unknown>,
  state: BoardState,
  resolver: () => AliasResolver,
): Promise<Map<string, ResolvedAliasValue> | undefined> {
  const plain = new Set<string>()
  const slotted: Array<{ memo: string; slot: EntitySlot }> = []
  for (const [key, value] of Object.entries(rawParams)) {
    const ref = entityRefOf(value, state)
    if (!ref) continue
    if (def.entitySlots && Object.prototype.hasOwnProperty.call(def.entitySlots, key)) slotted.push({ memo: ref.memo, slot: def.entitySlots[key] })
    else if (plainNarrowed(ref, state)) plain.add(ref.memo)
  }
  if (plain.size === 0 && slotted.length === 0) return undefined
  const r = resolver()
  const out = plain.size > 0 ? new Map(await r.values([...plain])) : new Map<string, ResolvedAliasValue>()
  for (const { memo, slot } of slotted) {
    const at = slotValueKey(memo, slot)
    if (!out.has(at)) out.set(at, await r.forSlot(memo, slot))
  }
  return out
}

/** Where `aliasValuesFor` keeps a reference's value as one slot takes it: per reference and the slot's kinds. */
export const slotValueKey = (memo: string, slot: EntitySlot): string => `${memo}>${[...slot.entityTypes].sort().join(',')}`

/** A plain reference to a narrowed pick that has a value: taken only once resolved (`aliasValuesFor`, `prepareParams`). */
const plainNarrowed = (ref: { key: string; filter?: string; legacy: boolean }, state: BoardState): boolean =>
  !ref.legacy && !ref.filter && isNarrowedPick(entityParamOf(state, ref.key)) && isPlainEntityParam(entityParamOf(state, ref.key))
  && Object.prototype.hasOwnProperty.call(state.paramValues, ref.key)

/**
 * May a `$param` slot whose parameter has no value be left out of the query (D442)? Only when the parameter is a hidden value
 * parameter of the board (the viewer has no control to choose it, so "choose a value in the filters above" could never be
 * followed: only the board's own clicks set it, and a click may leave it empty, as an element-convention item leaves the equipment
 * panel's `equipmentKeys`) and the query does not require the input: the query then runs on its own default. A parameter the
 * viewer can choose, an input the query requires, or a parameter the board does not define still asks for its value (the 422).
 */
export function mayLeaveOutUnset(def: Pick<DataSourceQueryDef, 'params'>, state: Pick<BoardState, 'params'>, slotKey: string, paramKey: string): boolean {
  const input = Object.prototype.hasOwnProperty.call(def.params, slotKey) ? (def.params[slotKey] as { required?: boolean } | undefined) : undefined
  if (!input || input.required === true) return false
  const param = (state.params ?? []).find((p) => p.key === paramKey)
  return !!param && isValueParam(param) && param.viewer === 'hidden'
}

/**
 * Entity references then `$param` references become literals BEFORE validation, so the source only ever sees a validated
 * value. In an entity slot an entity parameter is its resolved entities (the slot's types, one or many: `aliasSlotValue`);
 * outside one, only an entity the viewer or the page sets is taken, as its plain id (what the value parameter it was gave,
 * D41-7); anything else there is the 422 an alias always was. A reference whose value then fails the query's own schema is a
 * 422 (the board's value is wrong for THIS query), not the 400 a malformed literal gets.
 */
export function prepareParams(
  def: DataSourceQueryDef,
  rawParams: Record<string, unknown>,
  state: BoardState,
  hasBoardContext: boolean,
  aliasValues?: ReadonlyMap<string, ResolvedAliasValue>,
): Record<string, unknown> {
  let entityReferenced = false
  const entities: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(rawParams)) {
    const ref = entityRefOf(value, state)
    if (!ref) { entities[key] = value; continue }
    entityReferenced = true
    const slot = def.entitySlots && Object.prototype.hasOwnProperty.call(def.entitySlots, key) ? def.entitySlots[key] : undefined
    if (slot) {
      const resolved = aliasValues?.get(slotValueKey(ref.memo, slot))
      if (!resolved) throw new AppError(`${MSG.ALIAS_UNKNOWN}: '${ref.key}'`, 422, ErrorCode.VALIDATION_ERROR)
      entities[key] = aliasSlotValue(key, slot, resolved)
      continue
    }
    if (!ref.legacy && !ref.filter && isPlainEntityParam(entityParamOf(state, ref.key))) {
      if (!Object.prototype.hasOwnProperty.call(state.paramValues, ref.key)) {
        throw new AppError(`${MSG.BOARD_PARAM_UNRESOLVED}: '${ref.key}'`, 422, ErrorCode.VALIDATION_ERROR)
      }
      // A narrowed pick is its resolved entity, found in its set (the resolver's 422 otherwise); never the raw value unchecked.
      if (plainNarrowed(ref, state)) {
        const resolved = aliasValues?.get(ref.memo)?.refs[0]
        if (!resolved) throw new AppError(`${MSG.ALIAS_ENTITY_NOT_IN_SET}: '${ref.key}'`, 422, ErrorCode.VALIDATION_ERROR)
        entities[key] = resolved.id
        continue
      }
      entities[key] = state.paramValues[ref.key]
      continue
    }
    throw new AppError(`${MSG.ALIAS_SLOT_INVALID}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
  }
  const substituted = substituteParamRefs(entities, state.paramValues, hasBoardContext, (slotKey, paramKey) => mayLeaveOutUnset(def, state, slotKey, paramKey))
  substituted.referenced ||= entityReferenced
  try {
    return validateParams(def, substituted.params)
  } catch (e) {
    if (substituted.referenced && e instanceof AppError) {
      throw new AppError(MSG.QUERY_PARAMS_INVALID, 422, ErrorCode.VALIDATION_ERROR)
    }
    throw e
  }
}

