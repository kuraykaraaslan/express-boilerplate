import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import {
  MAX_ALIAS_ENTITIES, MAX_RELATION_LEVEL, aliasEntityType, holdersCapRefusal,
  type EntityAlias, type EntityAliasFilter, type EntitySlot, type ResolvedAliasValue, type SlotWords,
} from './board-aliases'
import { filterHolds, filterKeyTypes, type BoardFilter } from './board-filters'
import { graphCanHold, type DashboardEntityRelations, type DashboardEntityType, type EntityCtx, type EntityRef } from './entity-alias.types'
import { entityParamAlias, entityParamRefIssues, isEntityParam, type BoardParam, type EntityParamDef } from './board-params'

/**
 * Resolves board aliases (docs/phases/07-dashboard/36, E36-5…E36-8) against the contributed entity types and relation
 * providers. One resolver per request: each alias is resolved once (memoised), each permission asked once.
 *
 * Every module call is preceded by `authorize(<the contribution's requiredPermission>)`, the way gate ③ asks for a
 * query's permission, so a viewer who may not read devices cannot learn their names through an alias either.
 */
export interface AliasResolverDeps {
  /** The entity type contributed under `key`; 404 when no module contributes it, 409 when its module is off. */
  entityType(key: string): Promise<DashboardEntityType>
  relations(key: string): Promise<DashboardEntityRelations>
  /**
   * The keys of the relation graphs active for the tenant (`dashboard:entity_relations`), for a slot handed an entity of another
   * kind (D112: a site for a slot of devices takes what the site holds). Absent or empty = no entity hands its holdings on.
   */
  relationProviders?(): Promise<string[]>
  /**
   * Phase 49b (W2-M4): the active graphs with what each says a kind holds (`DashboardEntityRelations.holds`). With it a slot handed an entity of
   * another kind walks only the graphs that say that kind holds one of the slot's types; without it every graph of `relationProviders` is walked.
   */
  relationHoldings?(): Promise<Array<{ key: string; holds?: Readonly<Record<string, readonly string[]>> }>>
  /** Throws when the viewer lacks the permission (403). */
  authorize(permission: string): Promise<void>
}

/** The relation an entity holds another by (Legacy's Contains: a site, its floors and rooms, the devices placed in them). */
export const HOLDS_RELATION = 'CONTAINS'
/** At most this many entities hand a slot what they hold (a site parameter of many); more is a 422, never a silent cut. */
export const MAX_HOLDERS = 50

export interface AliasResolverInput {
  ctx: EntityCtx
  aliases: readonly EntityAlias[]
  /** The board's resolved param values (a state entity, a param root). */
  paramValues: Record<string, unknown>
  /** The board's param definitions: a param root takes its entity type from here. */
  params: readonly { key: string; entityType?: string }[]
  /** The viewer's current entity per single alias (E36-6). */
  aliasEntities?: Record<string, string>
  /** The board's key filters (36.7), applied when a reference names one. */
  filters?: readonly BoardFilter[]
  deps: AliasResolverDeps
  /**
   * Phase 41: the entity a relation root or a page choice that follows a parameter takes, when that parameter is itself resolved
   * (an entity parameter, its pick checked against its set); `undefined` = the phase 36 rule (the param's value as given, typed
   * by its `entityType`).
   */
  rootEntity?(paramKey: string): Promise<{ type: string; id: string } | null | undefined>
  /** Phase 41: the viewer's picks of a parameter of many entities, each checked to be one of its set. */
  pickedMany?: Record<string, readonly string[]>
  /**
   * Phase 41: whether a single alias with no pick takes the first entity of its set by name (the phase 36 rule, the default);
   * false = it is unresolved (422), as a value parameter with no value is.
   */
  firstWhenUnset?(alias: EntityAlias): boolean
}

export interface ResolvedAlias {
  alias: EntityAlias
  entityType: string | null
  /** A multiple alias: its entities, sorted by name, at most `MAX_ALIAS_ENTITIES`. A single one: its current entity, if any. */
  entities: EntityRef[]
  /** How many entities match in all (≥ `entities.length` for a multiple alias). */
  total: number
  truncated: boolean
}

export interface AliasResolver {
  /** An alias by key, or `<alias>|<filter>` for an alias through a board filter (36.7). */
  resolve(key: string): Promise<ResolvedAlias>
  /** The resolved values of `keys`, as `substituteAliasRefs` takes them. */
  values(keys: readonly string[]): Promise<Map<string, ResolvedAliasValue>>
  /** The whole set of an alias (for a single alias too): the toolbar select and the preview. */
  members(alias: EntityAlias, opts?: { search?: string; limit?: number }): Promise<{ entities: EntityRef[]; total: number }>
  /** The entities of an alias that pass a board filter (the filter editor's preview). */
  filtered(alias: EntityAlias, filter: BoardFilter, opts?: { search?: string; limit?: number }): Promise<{ entities: EntityRef[]; total: number }>
  /**
   * The value of `key` as one entity slot takes it (`aliasSlotValue` then decides one or many): the alias's own entities when
   * the slot takes their kind; otherwise (D112) the entities of the slot's kinds they hold, through every active relation graph
   * (`HOLDS_RELATION`, every level), named and readable, with the holders' names. Carries the parameter's label and the slot's
   * words for a refusal.
   */
  forSlot(key: string, slot: EntitySlot): Promise<ResolvedAliasValue>
}

const byName = (a: EntityRef, b: EntityRef): number => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

const stringValue = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

export function createAliasResolver(input: AliasResolverInput): AliasResolver {
  const { ctx, deps } = input
  const byKey = new Map(input.aliases.map((a) => [a.key, a]))
  const filtersByKey = new Map((input.filters ?? []).map((f) => [f.key, f]))
  const paramDefs = new Map(input.params.map((p) => [p.key, p]))
  const memo = new Map<string, Promise<ResolvedAlias>>()
  const asked = new Map<string, Promise<void>>()

  const authorize = (permission: string): Promise<void> => {
    let p = asked.get(permission)
    if (!p) { p = deps.authorize(permission); asked.set(permission, p) }
    return p
  }
  const types = new Map<string, Promise<DashboardEntityType>>()
  const providers = new Map<string, Promise<DashboardEntityRelations>>()
  const typeOf = (key: string): Promise<DashboardEntityType> => {
    let p = types.get(key)
    if (!p) {
      p = deps.entityType(key).then(async (t) => { await authorize(t.requiredPermission); return t })
      types.set(key, p)
    }
    return p
  }
  const relationsOf = (key: string): Promise<DashboardEntityRelations> => {
    let p = providers.get(key)
    if (!p) {
      p = deps.relations(key).then(async (r) => { await authorize(r.requiredPermission); return r })
      providers.set(key, p)
    }
    return p
  }

  /** `ids` of `type` that exist, sorted by name. */
  const named = async (type: string, ids: readonly string[]): Promise<EntityRef[]> => {
    if (ids.length === 0) return []
    const t = await typeOf(type)
    const unique = [...new Set(ids)].slice(0, MAX_ALIAS_ENTITIES)
    return (await t.byIds(ctx, unique)).map((e) => ({ ...e, type })).sort(byName)
  }

  /** The relation walk's root: a fixed entity, or the entity a board param holds (typed by the param's `entityType`). */
  const rootOf = async (f: Extract<EntityAliasFilter, { type: 'relationsQuery' | 'entitySearchQuery' }>): Promise<{ type: string; id: string } | null> => {
    if ('entity' in f.root) return f.root.entity
    const resolved = input.rootEntity ? await input.rootEntity(f.root.param) : undefined
    if (resolved !== undefined) return resolved
    const id = stringValue(input.paramValues[f.root.param])
    const type = paramDefs.get(f.root.param)?.entityType
    return id && type ? { type, id } : null
  }

  /**
   * The entity a state entity filter holds: the followed parameter's resolved entity when it is an entity parameter (phase 41:
   * never a pick outside that parameter's set), of the filter's type; else the param's value as given (phase 36).
   */
  const stateId = async (f: Extract<EntityAliasFilter, { type: 'stateEntity' }>): Promise<string | null> => {
    const resolved = input.rootEntity ? await input.rootEntity(f.param) : undefined
    if (resolved !== undefined) return resolved && resolved.type === f.entityType ? resolved.id : null
    return stringValue(input.paramValues[f.param])
  }

  /** Every entity a relation walk reaches, named and sorted, grouped back by type. */
  const walk = async (
    f: Extract<EntityAliasFilter, { type: 'relationsQuery' | 'entitySearchQuery' }>,
  ): Promise<EntityRef[]> => {
    const root = await rootOf(f)
    if (!root) return []
    // The root must be an entity the viewer may see, of a type that exists here.
    if ((await named(root.type, [root.id])).length === 0) return []
    const provider = await relationsOf(f.provider)
    // A search query keeps the entities of its own type. Over one level its walk follows only the edges that end at one; over more levels it
    // also crosses the entities between (a site's plants, floors and rooms before the devices in them), which a graph that follows only the
    // edges a filter matches would otherwise never reach (49b review, R49b-1: "the devices under this site, any depth"). Those in between are
    // dropped unnamed.
    const crossing = f.type === 'entitySearchQuery' && f.maxLevel > 1
    const filters = f.type === 'relationsQuery'
      ? f.filters
      : crossing
        ? (f.relationType ? [{ relationType: f.relationType }] : [])
        : [{ ...(f.relationType ? { relationType: f.relationType } : {}), entityTypes: [f.entityType] }]
    const found = await provider.query(ctx, {
      root, direction: f.direction, maxLevel: f.maxLevel, lastLevelOnly: f.lastLevelOnly ?? false, filters,
      // Read a little past the cap so that what does not exist any more (or is not readable) still leaves a full set.
      limit: MAX_ALIAS_ENTITIES * 2,
    })
    const groups = new Map<string, string[]>()
    for (const r of found) {
      if (r.type === root.type && r.id === root.id) continue
      if (f.type === 'entitySearchQuery' && r.type !== f.entityType) continue
      const list = groups.get(r.type) ?? []
      list.push(r.id)
      groups.set(r.type, list)
    }
    const out: EntityRef[] = []
    for (const [type, ids] of groups) out.push(...await named(type, ids))
    let rows = out.sort(byName)
    if (f.type === 'entitySearchQuery') {
      rows = rows.filter((e) => e.type === f.entityType)
      if (f.subtypes?.length) rows = rows.filter((e) => !!e.subtype && f.subtypes!.includes(e.subtype))
    }
    return rows
  }

  /** The set a filter selects, sorted by name: at most `limit` entities, and how many in all. */
  const select = async (f: EntityAliasFilter, limit: number, search?: string): Promise<{ entities: EntityRef[]; total: number }> => {
    const cap = (rows: EntityRef[]) => {
      const q = search?.trim().toLowerCase()
      const hit = q ? rows.filter((e) => e.name.toLowerCase().includes(q) || (e.label ?? '').toLowerCase().includes(q)) : rows
      return { entities: hit.slice(0, limit), total: hit.length }
    }
    switch (f.type) {
      case 'singleEntity':
        return cap(await named(f.entityType, [f.id]))
      case 'entityList':
        return cap(await named(f.entityType, f.ids))
      case 'stateEntity': {
        const id = await stateId(f)
        return cap(id ? await named(f.entityType, [id]) : [])
      }
      case 'entityName':
      case 'entityType':
      case 'entitySubtype': {
        const t = await typeOf(f.entityType)
        const r = await t.find(ctx, {
          ...(f.type === 'entitySubtype' ? { subtypes: f.subtypes } : {}),
          ...(f.type !== 'entityType' && f.namePrefix ? { namePrefix: f.namePrefix } : {}),
          ...(search?.trim() ? { search: search.trim() } : {}),
          limit,
        })
        return { entities: r.rows.map((e) => ({ ...e, type: f.entityType })), total: r.total }
      }
      case 'relationsQuery':
      case 'entitySearchQuery':
        return cap(await walk(f))
    }
  }

  /** Is `id` one of the entities the filter selects? Asked for the viewer's choice of a single alias (E36-6). */
  const contains = async (f: EntityAliasFilter, id: string): Promise<EntityRef | null> => {
    switch (f.type) {
      case 'singleEntity':
        return f.id === id ? (await named(f.entityType, [id]))[0] ?? null : null
      case 'entityList':
        return f.ids.includes(id) ? (await named(f.entityType, [id]))[0] ?? null : null
      case 'stateEntity':
        return (await stateId(f)) === id ? (await named(f.entityType, [id]))[0] ?? null : null
      default:
        return (await containsAll(f, [id]))[0] ?? null
    }
  }

  /** A name prefix or a subtype list holds for `e`. */
  const holds = (f: Extract<EntityAliasFilter, { type: 'entityName' | 'entitySubtype' }>, e: EntityRef): boolean =>
    (!f.namePrefix || e.name.toLowerCase().startsWith(f.namePrefix.toLowerCase()))
    && (f.type !== 'entitySubtype' || (!!e.subtype && f.subtypes.includes(e.subtype)))

  /**
   * The entities of `ids` the filter selects, sorted by name: each asked by its id, so a pick is found wherever it sorts, not
   * only among the first `MAX_ALIAS_ENTITIES` by name (phase 41, the viewer's picks of a parameter of many).
   */
  const containsAll = async (f: EntityAliasFilter, ids: readonly string[]): Promise<EntityRef[]> => {
    switch (f.type) {
      case 'singleEntity':
        return named(f.entityType, ids.filter((id) => id === f.id))
      case 'entityList':
        return named(f.entityType, ids.filter((id) => f.ids.includes(id)))
      case 'stateEntity': {
        const held = await stateId(f)
        return named(f.entityType, ids.filter((id) => id === held))
      }
      case 'entityType':
        return named(f.entityType, ids)
      case 'entityName':
      case 'entitySubtype':
        return (await named(f.entityType, ids)).filter((e) => holds(f, e))
      case 'relationsQuery':
      case 'entitySearchQuery': {
        const wanted = new Set(ids)
        return (await walk(f)).filter((e) => wanted.has(e.id))
      }
    }
  }

  const pickOf = (alias: EntityAlias): string | undefined => (input.aliasEntities && Object.prototype.hasOwnProperty.call(input.aliasEntities, alias.key)
    ? input.aliasEntities[alias.key] : undefined)
  const pickedManyOf = (alias: EntityAlias): readonly string[] | undefined => (input.pickedMany && Object.prototype.hasOwnProperty.call(input.pickedMany, alias.key)
    ? input.pickedMany[alias.key] : undefined)
  /** The viewer's picks of a multiple alias, each one of `set` (phase 41), in the set's order; a 422 for one outside it. */
  const pickFrom = (alias: EntityAlias, set: EntityRef[], picked: readonly string[]): EntityRef[] => {
    const wanted = new Set(picked)
    const hits = set.filter((e) => wanted.has(e.id))
    if (new Set(hits.map((e) => e.id)).size !== wanted.size) throw new AppError(`${MSG.ALIAS_ENTITY_NOT_IN_SET}: '${alias.key}'`, 422, ErrorCode.VALIDATION_ERROR)
    return hits
  }
  const unresolved = (alias: EntityAlias): AppError => new AppError(`${MSG.BOARD_PARAM_UNRESOLVED}: '${alias.key}'`, 422, ErrorCode.VALIDATION_ERROR)

  const resolveAlias = async (alias: EntityAlias): Promise<ResolvedAlias> => {
    const entityType = aliasEntityType(alias)
    if (alias.resolveMultiple) {
      const picked = pickedManyOf(alias)
      if (picked) { const hits = pickFrom(alias, await containsAll(alias.filter, picked), picked); return { alias, entityType, entities: hits, total: hits.length, truncated: false } }
      const { entities, total } = await select(alias.filter, MAX_ALIAS_ENTITIES)
      return { alias, entityType, entities, total, truncated: total > entities.length }
    }
    const chosen = pickOf(alias)
    if (chosen !== undefined) {
      const hit = await contains(alias.filter, chosen)
      if (!hit) throw new AppError(`${MSG.ALIAS_ENTITY_NOT_IN_SET}: '${alias.key}'`, 422, ErrorCode.VALIDATION_ERROR)
      return { alias, entityType, entities: [hit], total: 1, truncated: false }
    }
    if (input.firstWhenUnset && !input.firstWhenUnset(alias)) throw unresolved(alias)
    // TB: a single alias's current entity is the first match (here: the first by name).
    const { entities, total } = await select(alias.filter, 1)
    return { alias, entityType, entities: entities.slice(0, 1), total: Math.min(total, 1), truncated: false }
  }

  /** The entities of `rows` that pass a board filter, read per entity type behind each key type's permission (36.7). */
  const applyFilter = async (rows: EntityRef[], filter: BoardFilter): Promise<EntityRef[]> => {
    const byType = new Map<string, EntityRef[]>()
    for (const e of rows) byType.set(e.type, [...(byType.get(e.type) ?? []), e])
    const keep = new Set<string>()
    for (const [type, list] of byType) {
      const t = await typeOf(type)
      if (!t.readKeys) throw new AppError(`${MSG.FILTER_NOT_SUPPORTED}: '${type}'`, 422, ErrorCode.VALIDATION_ERROR)
      for (const kt of filterKeyTypes(filter)) {
        const permission = t.keyPermissions?.[kt]
        if (!permission) throw new AppError(`${MSG.FILTER_NOT_SUPPORTED}: '${type}' ${kt}`, 422, ErrorCode.VALIDATION_ERROR)
        await authorize(permission)
      }
      const values = await t.readKeys(ctx, list.map((e) => e.id), filter.keyFilters.map((kf) => kf.key))
      for (const e of list) {
        const v = values.get(e.id)
        if (v && filterHolds(v, filter, input.paramValues)) keep.add(`${e.type}:${e.id}`)
      }
    }
    return rows.filter((e) => keep.has(`${e.type}:${e.id}`))
  }

  const resolveFiltered = async (alias: EntityAlias, filter: BoardFilter): Promise<ResolvedAlias> => {
    const entityType = aliasEntityType(alias)
    const picked = alias.resolveMultiple ? pickedManyOf(alias) : undefined
    if (picked) {
      // The picks, each asked by id and then through the filter (not out of the first `MAX_ALIAS_ENTITIES` by name).
      const hits = pickFrom(alias, await applyFilter(await containsAll(alias.filter, picked), filter), picked)
      return { alias, entityType, entities: hits, total: hits.length, truncated: false }
    }
    const { entities: candidates, total: before } = await select(alias.filter, MAX_ALIAS_ENTITIES)
    const kept = await applyFilter(candidates, filter)
    if (alias.resolveMultiple) {
      return { alias, entityType, entities: kept, total: kept.length, truncated: before > candidates.length }
    }
    const chosen = pickOf(alias)
    if (chosen !== undefined) {
      const hit = kept.find((e) => e.id === chosen)
      if (!hit) throw new AppError(`${MSG.ALIAS_ENTITY_NOT_IN_SET}: '${alias.key}'`, 422, ErrorCode.VALIDATION_ERROR)
      return { alias, entityType, entities: [hit], total: 1, truncated: false }
    }
    if (input.firstWhenUnset && !input.firstWhenUnset(alias)) throw unresolved(alias)
    return { alias, entityType, entities: kept.slice(0, 1), total: Math.min(kept.length, 1), truncated: false }
  }

  const resolve = (key: string): Promise<ResolvedAlias> => {
    let p = memo.get(key)
    if (!p) {
      const [aliasKey, filterKey] = key.split('|')
      const alias = byKey.get(aliasKey)
      const filter = filterKey !== undefined ? filtersByKey.get(filterKey) : undefined
      p = !alias
        ? Promise.reject(new AppError(`${MSG.ALIAS_UNKNOWN}: '${aliasKey}'`, 422, ErrorCode.VALIDATION_ERROR))
        : filterKey !== undefined && !filter
          ? Promise.reject(new AppError(`${MSG.FILTER_UNKNOWN}: '${filterKey}'`, 422, ErrorCode.VALIDATION_ERROR))
          : filter ? resolveFiltered(alias, filter) : resolveAlias(alias)
      memo.set(key, p)
    }
    return p
  }

  /**
   * The graphs that can hand a slot of `types` what an entity of `type` holds: every active graph, narrowed to those whose declared holdings say
   * so (phase 49b, W2-M4; a graph that declares none may hold anything).
   */
  const holdingGraphs = async (type: string | null, types: readonly string[]): Promise<string[]> => {
    if (deps.relationHoldings) return (await deps.relationHoldings()).filter((g) => graphCanHold(g.holds, type, types)).map((g) => g.key)
    return deps.relationProviders ? deps.relationProviders() : []
  }

  /** The entities of `types` the holders hold, through the graphs `keys` (every one that can hold them), named, readable and sorted (D112). */
  const heldBy = async (holders: EntityRef[], types: readonly string[], keys: readonly string[]): Promise<EntityRef[]> => {
    const found = new Map<string, Set<string>>()
    for (const key of keys) {
      const provider = await relationsOf(key)
      for (const root of holders) {
        const rows = await provider.query(ctx, {
          root: { type: root.type, id: root.id }, direction: 'from', maxLevel: MAX_RELATION_LEVEL, lastLevelOnly: false,
          filters: [{ relationType: HOLDS_RELATION }], limit: MAX_ALIAS_ENTITIES * 2,
        })
        for (const r of rows) {
          if (!types.includes(r.type) || (r.type === root.type && r.id === root.id)) continue
          const ids = found.get(r.type) ?? new Set<string>()
          ids.add(r.id)
          found.set(r.type, ids)
        }
      }
    }
    const out: EntityRef[] = []
    for (const [type, ids] of found) out.push(...await named(type, [...ids]))
    return out.sort(byName)
  }

  /** A slot's kind in words: its first type's labels, in English (the message) and in the viewer's language (the details). */
  const wordsOf = async (types: readonly string[]): Promise<{ en: SlotWords; local: SlotWords } | undefined> => {
    if (types.length === 0) return undefined
    const t = await typeOf(types[0])
    const lower = (w: { one: string; many: string }): SlotWords => ({ one: w.one.toLowerCase(), many: w.many.toLowerCase() })
    return { en: lower(t.labels('en')), local: lower(t.labels(ctx.locale)) }
  }
  /** `wordsOf` for a refusal's wording only: an entity type that cannot be read for its labels leaves the words out, never the refusal. */
  const wordsIfAny = (types: readonly string[]) => wordsOf(types).catch(() => undefined)

  const forSlot = async (key: string, slot: EntitySlot): Promise<ResolvedAliasValue> => {
    const r = await resolve(key)
    const types = new Set(r.entities.map((e) => e.type))
    const entityType = r.entityType ?? (types.size === 1 ? [...types][0] : null)
    const own: ResolvedAliasValue = {
      entityType, multiple: r.alias.resolveMultiple, refs: r.entities.map((e) => ({ type: e.type, id: e.id })), name: r.alias.name,
      named: r.entities.map((e) => ({ type: e.type, id: e.id, name: e.name })),
    }
    // What the slot takes is there (or a mixed set gives it its own kinds): the alias's own entities.
    const fits = entityType === null ? r.entities.some((e) => slot.entityTypes.includes(e.type)) || r.entities.length === 0
      : slot.entityTypes.includes(entityType)
    const graphs = !fits ? await holdingGraphs(entityType, slot.entityTypes) : []
    if (fits || graphs.length === 0) {
      // 49b (W2-M4): a kind the slot does not take, held by no graph: the refusal says both kinds in words (`aliasSlotValue`)
      if (!fits) return { ...own, words: await wordsIfAny(slot.entityTypes), ...(entityType ? { given: await wordsIfAny([entityType]) } : {}) }
      const many = !slot.multiple && own.multiple && own.refs.filter((x) => slot.entityTypes.includes(x.type)).length > 1
      return many ? { ...own, words: await wordsOf(slot.entityTypes) } : own
    }
    // Nothing to hand on (a set that matched nothing): an empty value, as an alias of the slot's own kind that matched nothing.
    if (r.entities.length === 0) return { entityType: null, multiple: own.multiple, refs: [], name: r.alias.name }
    if (r.entities.length > MAX_HOLDERS) {
      throw holdersCapRefusal(key, r.alias.name, r.entities.length, await wordsIfAny(entityType ? [entityType] : []), MAX_HOLDERS)
    }
    const held = await heldBy(r.entities, slot.entityTypes, graphs)
    const value: ResolvedAliasValue = {
      entityType: slot.entityTypes.length === 1 ? slot.entityTypes[0] : null,
      multiple: true,
      refs: held.map((e) => ({ type: e.type, id: e.id })),
      heldBy: r.entities.map((e) => e.name),
      name: r.alias.name,
      named: held.map((e) => ({ type: e.type, id: e.id, name: e.name })),
    }
    return !slot.multiple && held.length !== 1 ? { ...value, words: await wordsOf(slot.entityTypes) } : value
  }

  return {
    resolve,
    forSlot,
    async values(keys) {
      const out = new Map<string, ResolvedAliasValue>()
      for (const key of keys) {
        const r = await resolve(key)
        const types = new Set(r.entities.map((e) => e.type))
        out.set(key, {
          entityType: r.entityType ?? (types.size === 1 ? [...types][0] : null),
          multiple: r.alias.resolveMultiple,
          refs: r.entities.map((e) => ({ type: e.type, id: e.id })),
        })
      }
      return out
    },
    async members(alias, opts = {}) {
      const limit = Math.min(Math.max(1, opts.limit ?? 50), MAX_ALIAS_ENTITIES)
      return select(alias.filter, limit, opts.search)
    },
    async filtered(alias, filter, opts = {}) {
      const limit = Math.min(Math.max(1, opts.limit ?? 50), MAX_ALIAS_ENTITIES)
      const { entities } = await select(alias.filter, MAX_ALIAS_ENTITIES, opts.search)
      const kept = await applyFilter(entities, filter)
      return { entities: kept.slice(0, limit), total: kept.length }
    },
  }
}

// ── phase 41: entity parameters ─────────────────────────────────────────────────────────────────────────────────────

export interface ParamResolverInput {
  ctx: EntityCtx
  /** The board's parameters, both kinds (`board-params.ts`). */
  params: readonly BoardParam[]
  /** Their effective values (`resolveBoardParamValues`): an entity parameter's pick, a value parameter's value. */
  values: Record<string, unknown>
  filters?: readonly BoardFilter[]
  deps: AliasResolverDeps
}

/**
 * The resolver of a board's entity parameters (docs/phases/07-dashboard/41, D41-8): the alias resolver above, each entity
 * parameter as the alias of its choice, under the same gates (each entity type's read permission before any module call,
 * the 500-entity cap, a pick taken only inside the resolved set). What phase 41 adds: a single parameter with no value takes
 * the first entity only when it says so (`defaultFrom: 'firstOption'`) or is one fixed entity, else it is unresolved (422) as
 * a value parameter is; a parameter of many takes the viewer's picks inside its set; a relation root or a page choice that
 * follows an entity parameter takes that parameter's resolved entity, never the raw pick (a pick outside a fixed or related
 * set is the followed parameter's 422).
 */
/**
 * Whether a single entity parameter with no value takes the first entity of its set by name: when it says so, when it is one fixed
 * entity, and an old alias that is no parameter always did (TB). The run time's rule (`createParamResolver`) and the preview's
 * (`previewNotes`, AD-12), so the two never disagree.
 */
export const takesFirstWhenUnset = (p: EntityParamDef | undefined): boolean =>
  !p || p.defaultFrom === 'firstOption' || p.choose.type === 'single'

export function createParamResolver(input: ParamResolverInput): AliasResolver {
  const entities = input.params.filter(isEntityParam)
  const byKey = new Map(entities.map((p) => [p.key, p]))
  const aliasEntities: Record<string, string> = {}
  const pickedMany: Record<string, string[]> = {}
  for (const p of entities) {
    const v = input.values[p.key]
    if (p.multiple && Array.isArray(v)) pickedMany[p.key] = v as string[]
    else if (!p.multiple && typeof v === 'string') aliasEntities[p.key] = v
  }
  // A followed parameter that is not one entity (of a known type, for a root), or whose chain of followed parameters comes back,
  // is refused here as the write refuses it (`entityParamRefIssues`): every parameter of a cycle has an issue, so a resolution
  // never waits on itself.
  const badRoots = new Set(entityParamRefIssues(input.params).map((i) => i.key))
  const resolver: AliasResolver = createAliasResolver({
    ctx: input.ctx,
    aliases: entities.map(entityParamAlias),
    paramValues: input.values,
    params: input.params.map((p) => ({ key: p.key, ...(p.entityType ? { entityType: p.entityType } : {}) })),
    aliasEntities,
    pickedMany,
    filters: input.filters ?? [],
    deps: input.deps,
    firstWhenUnset: (alias) => takesFirstWhenUnset(byKey.get(alias.key)),
    async rootEntity(paramKey) {
      const p = byKey.get(paramKey)
      if (!p) return undefined
      if (badRoots.has(paramKey) || p.multiple) throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${paramKey}'`, 422, ErrorCode.VALIDATION_ERROR)
      try {
        const e = (await resolver.resolve(paramKey)).entities[0]
        return e ? { type: e.type, id: e.id } : null
      } catch (err) {
        // A followed parameter with no value leaves the walk (or the page's set) empty, the phase 36 rule for a param with none.
        if (err instanceof AppError && err.message.startsWith(MSG.BOARD_PARAM_UNRESOLVED)) return null
        throw err
      }
    },
  })
  return resolver
}
