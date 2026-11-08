import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { BoardParamKeySchema } from './board-window'

/**
 * Board entity aliases (docs/phases/07-dashboard/36): named entity filters that belong to the board, the Legacy model.
 * A widget names one with `{ "$alias": "<key>" }` in a query param the query declares as an entity slot; the server
 * resolves it (`alias-resolver.ts`) and substitutes the ids before the query's own validation, the `$param` path.
 *
 * Pure: schemas, reference collection and substitution. Resolution needs the contributed entity types and lives in
 * `alias-resolver.ts`.
 */

/** At most this many aliases per board (E36-8). */
export const MAX_BOARD_ALIASES = 32
/** A resolved set is cut at this many entities, first by name (E36-8; `iot_device`'s `DEVICES_MAX_ROWS`). */
export const MAX_ALIAS_ENTITIES = 500
export const MAX_ENTITY_LIST = 100
export const MAX_NAME_PREFIX = 120
export const MAX_SUBTYPES = 50
export const MAX_RELATION_LEVEL = 10
export const MAX_RELATION_FILTERS = 8

/** An entity type or relation provider key: the contribution key a module registers (`iot_device`). */
export const ContributionKeySchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,59}$/, 'Invalid entity type')
/** An entity id as a module hands it out: an opaque token, never a path or a query. */
export const EntityIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/, 'Invalid entity id')
export const SubtypeSchema = z.string().min(1).max(120)
export const RelationTypeSchema = z.string().min(1).max(60).regex(/^[A-Za-z][A-Za-z0-9_ -]{0,59}$/, 'Invalid relation type')

export const AliasRootSchema = z.union([
  z.object({ entity: z.object({ type: ContributionKeySchema, id: EntityIdSchema }).strict() }).strict(),
  z.object({ param: BoardParamKeySchema }).strict(),
])

const RelationWalk = {
  provider: ContributionKeySchema,
  root: AliasRootSchema,
  direction: z.enum(['from', 'to']),
  maxLevel: z.number().int().min(1).max(MAX_RELATION_LEVEL),
  lastLevelOnly: z.boolean().optional(),
}

export const EntityAliasFilterSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('singleEntity'), entityType: ContributionKeySchema, id: EntityIdSchema }).strict(),
  z.object({ type: z.literal('entityList'), entityType: ContributionKeySchema, ids: z.array(EntityIdSchema).min(1).max(MAX_ENTITY_LIST) }).strict(),
  z.object({ type: z.literal('entityName'), entityType: ContributionKeySchema, namePrefix: z.string().min(1).max(MAX_NAME_PREFIX) }).strict(),
  z.object({ type: z.literal('entityType'), entityType: ContributionKeySchema }).strict(),
  z.object({ type: z.literal('stateEntity'), entityType: ContributionKeySchema, param: BoardParamKeySchema }).strict(),
  z.object({
    type: z.literal('entitySubtype'), entityType: ContributionKeySchema,
    subtypes: z.array(SubtypeSchema).min(1).max(MAX_SUBTYPES), namePrefix: z.string().min(1).max(MAX_NAME_PREFIX).optional(),
  }).strict(),
  z.object({
    type: z.literal('relationsQuery'), ...RelationWalk,
    filters: z.array(z.object({
      relationType: RelationTypeSchema.optional(),
      entityTypes: z.array(ContributionKeySchema).max(20).optional(),
      negate: z.boolean().optional(),
    }).strict()).max(MAX_RELATION_FILTERS),
  }).strict(),
  z.object({
    type: z.literal('entitySearchQuery'), ...RelationWalk,
    relationType: RelationTypeSchema.optional(), entityType: ContributionKeySchema,
    subtypes: z.array(SubtypeSchema).max(MAX_SUBTYPES).optional(),
  }).strict(),
])
export type EntityAliasFilter = z.infer<typeof EntityAliasFilterSchema>
export type AliasFilterType = EntityAliasFilter['type']

export const EntityAliasSchema = z
  .object({
    /** Read like a param key, so `{ $alias: key }` reads like `{ $param: key }`. */
    key: BoardParamKeySchema,
    name: z.string().trim().min(1).max(80),
    resolveMultiple: z.boolean(),
    filter: EntityAliasFilterSchema,
  })
  .strict()
  // TB: a single entity is one entity; resolving it "as many" means nothing.
  .refine((a) => !(a.filter.type === 'singleEntity' && a.resolveMultiple), { message: 'A single entity cannot resolve as multiple', path: ['resolveMultiple'] })
export type EntityAlias = z.infer<typeof EntityAliasSchema>

export const BoardAliasesSchema = z
  .array(EntityAliasSchema)
  .max(MAX_BOARD_ALIASES)
  .superRefine((aliases, ctx) => {
    const keys = new Set<string>()
    const names = new Set<string>()
    aliases.forEach((a, i) => {
      if (keys.has(a.key)) ctx.addIssue({ code: 'custom', message: 'Duplicate alias key', path: [i, 'key'] })
      keys.add(a.key)
      const name = a.name.toLowerCase()
      if (names.has(name)) ctx.addIssue({ code: 'custom', message: 'Duplicate alias name', path: [i, 'name'] })
      names.add(name)
    })
  })

/** The board params an alias reads (a state entity, a param root): they may not be removed while it does. */
export function aliasParamKeys(aliases: readonly EntityAlias[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const a of aliases ?? []) {
    const f = a.filter
    if (f.type === 'stateEntity') out.add(f.param)
    if ((f.type === 'relationsQuery' || f.type === 'entitySearchQuery') && 'param' in f.root) out.add(f.root.param)
  }
  return out
}

/** The entity type an alias resolves to, when it is known without resolving (a relations query may mix types). */
export function aliasEntityType(a: Pick<EntityAlias, 'filter'>): string | null {
  return a.filter.type === 'relationsQuery' ? null : a.filter.entityType
}

/**
 * The aliases the toolbar entity select offers (TB, E36-6): resolved as one entity, and not a fixed single entity. The board-open
 * answer lists exactly these (phase 40, D40-12).
 */
export const selectableAliases = (aliases: readonly EntityAlias[]): EntityAlias[] =>
  aliases.filter((a) => !a.resolveMultiple && a.filter.type !== 'singleEntity')

// ── references ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** A `{ "$alias": "<key>" }` slot value, optionally with a board filter (`"filter": "<key>"`, 36.7). */
export function isAliasRef(value: unknown): value is { $alias: string; filter?: string } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Object.keys(value)
  const v = value as { $alias?: unknown; filter?: unknown }
  return typeof v.$alias === 'string' && keys.every((k) => k === '$alias' || k === 'filter')
    && (v.filter === undefined || typeof v.filter === 'string')
}

/** The memo key of one reference: the alias, or the alias through a filter. */
export const aliasRefKey = (ref: { $alias: string; filter?: string }): string => (ref.filter ? `${ref.$alias}|${ref.filter}` : ref.$alias)

/** A reference through a board filter: an old `{ $alias, filter }` or, since phase 41, `{ $param, filter }`. */
function filterOfRef(value: unknown): string | undefined {
  if (isAliasRef(value)) return value.filter
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const v = value as { $param?: unknown; filter?: unknown }
  return typeof v.$param === 'string' && typeof v.filter === 'string' && Object.keys(value).every((k) => k === '$param' || k === 'filter') ? v.filter : undefined
}

/** Every filter key a set of stored bindings references. */
export function referencedFilterKeys(bindings: Array<Record<string, { params?: Record<string, unknown> } | null | undefined> | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const binding of bindings) {
    for (const slot of Object.values(binding ?? {})) {
      for (const value of Object.values(slot?.params ?? {})) { const f = filterOfRef(value); if (f) out.add(f) }
    }
  }
  return out
}

/** Every alias key a set of stored bindings references. Pure: the caller hands over the bindings. */
export function referencedAliasKeys(bindings: Array<Record<string, { params?: Record<string, unknown> } | null | undefined> | null | undefined>): Set<string> {
  const out = new Set<string>()
  for (const binding of bindings) {
    for (const slot of Object.values(binding ?? {})) {
      for (const value of Object.values(slot?.params ?? {})) if (isAliasRef(value)) out.add(value.$alias)
    }
  }
  return out
}

/** The alias references of one query's params, by memo key (an alias alone, or through a filter). */
export function paramAliasKeys(params: Record<string, unknown>): string[] {
  return [...new Set(Object.values(params).filter(isAliasRef).map(aliasRefKey))]
}

/** The aliases present in `before` and gone from `after`, by key. */
export function removedAliasKeys(before: readonly { key: string }[] | null | undefined, after: readonly { key: string }[] | null | undefined): string[] {
  const kept = new Set((after ?? []).map((a) => a.key))
  return (before ?? []).map((a) => a.key).filter((k) => !kept.has(k))
}

// ── entity slots ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** What a query declares a param takes (`DataSourceQueryDef.entitySlots`, E36-4). */
export interface EntitySlot {
  entityTypes: string[]
  multiple: boolean
}

/** A resolved alias as a binding consumes it. */
export interface ResolvedAliasValue {
  /** The one entity type of the set; null when a relations query mixed types. */
  entityType: string | null
  multiple: boolean
  /** The current entity of a single alias, every entity of a multiple one (sorted by name). */
  refs: Array<{ type: string; id: string }>
  /**
   * D112: the refs are the entities the alias's own entities hold (a site handed to a slot of devices: the site's devices, through
   * the entity-relations contribution), and these are the holders' names. Absent = the refs are the alias's own entities.
   */
  heldBy?: string[]
  /** The parameter's label, for a refusal that names it (`aliasSlotValue`). */
  name?: string
  /** The entities of `refs` with their names, when the resolver had them at hand (`forSlot`): the editor's answer names them. */
  named?: Array<{ type: string; id: string; name: string }>
  /** The slot's kind of entity in words (its first type's labels), for a refusal that counts them: `en` for the message, `local` for the details. */
  words?: { en: SlotWords; local: SlotWords }
  /** Phase 49b (W2-M4): the parameter's own kind in words, for the refusal of a kind the slot does not take ("Site gives assets; this card takes devices"). */
  given?: { en: SlotWords; local: SlotWords }
}

/** One entity type's words as a refusal counts them ("device", "devices"). */
export interface SlotWords { one: string; many: string }

/**
 * The refusals of a slot that takes one entity and is given several (D112 for a holder, AD-12 for a parameter of many), in the
 * words D112 fixes. The English sentence is the server's message (logs, API callers); `details.messageKey` and its words let the
 * viewer read it in their language (`keyedRefusalText`), so the card and the settings drawer say the same words.
 */
export const SLOT_REFUSAL_KEYS = {
  holdsMany: 'dashboard.errors.slotHoldsMany',
  holdsNone: 'dashboard.errors.slotHoldsNone',
  givesMany: 'dashboard.errors.slotGivesMany',
  /** Phase 49b (W2-M4): ALIAS_SLOT_TYPE in words: the parameter's label, its kind and the slot's. */
  wrongKind: 'dashboard.errors.slotWrongKind',
  /** Phase 49b: more holders than a card looks inside (`MAX_HOLDERS` of the resolver), in words. */
  holdersCap: 'dashboard.errors.slotHoldersCap',
} as const

/**
 * The refusal of a parameter whose kind a slot does not take and nothing it holds can fill (ALIAS_SLOT_TYPE), in words (phase 49b, W2-M4): "Site
 * gives assets; this card takes devices", with `details` for the viewer's language. Without the words (a caller that resolved no labels, a write-time
 * check) the old message with the query's key stays: an API caller still learns which param.
 */
export function slotKindRefusal(key: string, resolved: Pick<ResolvedAliasValue, 'name' | 'words' | 'given'>): AppError {
  const { name, words, given } = resolved
  if (!name || !words || !given) return new AppError(`${MSG.ALIAS_SLOT_TYPE}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
  return new AppError(`${name} gives ${given.en.many}; this card takes ${words.en.many}`, 422, ErrorCode.VALIDATION_ERROR, {
    details: { messageKey: SLOT_REFUSAL_KEYS.wrongKind, name, kind: words.local.one, kinds: words.local.many, given: given.local.many },
  })
}

/** More holders than a card looks inside (phase 49b): "Sites gives 60 assets; a card looks inside at most 50 of them". */
export function holdersCapRefusal(key: string, name: string | undefined, count: number, given: { en: SlotWords; local: SlotWords } | undefined, max = 50): AppError {
  if (!name) return new AppError(`${MSG.ALIAS_SLOT_TYPE}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
  const en = given?.en.many ?? 'entities'
  return new AppError(`${name} gives ${count} ${en}; a card looks inside at most ${max} of them`, 422, ErrorCode.VALIDATION_ERROR, {
    details: { messageKey: SLOT_REFUSAL_KEYS.holdersCap, name, count, max, given: given?.local.many ?? en },
  })
}

function slotRefusal(kind: keyof typeof SLOT_REFUSAL_KEYS, resolved: ResolvedAliasValue, count: number): AppError {
  const holders = resolved.heldBy ?? []
  const name = holders.length === 1 ? holders[0] : resolved.name ?? ''
  const en = resolved.words?.en ?? { one: 'entity', many: 'entities' }
  const local = resolved.words?.local ?? en
  const english = kind === 'holdsMany' ? `${name} holds ${count} ${en.many}; pick one`
    : kind === 'holdsNone' ? `${name} holds no ${en.one}`
      : `${name} gives ${count} ${en.many}; this card shows one, pick one`
  return new AppError(english, 422, ErrorCode.VALIDATION_ERROR, {
    details: { messageKey: SLOT_REFUSAL_KEYS[kind], name, count, kind: local.one, kinds: local.many },
  })
}

/**
 * Replace `$alias` references with resolved ids BEFORE the query's own validation, the `$param` rule: the source only
 * sees a validated literal. A reference is a 422 when the param is not an entity slot, the alias is unknown, its entity
 * type is not one the slot takes, or it resolves to many and the slot takes one.
 */
export function substituteAliasRefs(
  params: Record<string, unknown>,
  slots: Record<string, EntitySlot> | undefined,
  values: ReadonlyMap<string, ResolvedAliasValue>,
): { params: Record<string, unknown>; referenced: boolean } {
  let referenced = false
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params)) {
    if (!isAliasRef(value)) { out[key] = value; continue }
    referenced = true
    const slot = slots && Object.prototype.hasOwnProperty.call(slots, key) ? slots[key] : undefined
    if (!slot) throw new AppError(`${MSG.ALIAS_SLOT_INVALID}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
    const resolved = values.get(aliasRefKey(value))
    if (!resolved) throw new AppError(`${MSG.ALIAS_UNKNOWN}: '${value.$alias}'`, 422, ErrorCode.VALIDATION_ERROR)
    out[key] = aliasSlotValue(key, slot, resolved)
  }
  return { params: out, referenced }
}

/**
 * The literal one resolved alias becomes in one slot, or the 422 that says why it cannot. A slot of many takes every entity of
 * its types. A slot of one takes a single alias's entity; given several, the run-time rule is D112's (and AD-12's, so a preview
 * and a card agree): it takes the one when exactly one is there, else a 422 that names what holds them and how many ("Pool
 * plant · Antalya holds 3 devices; pick one"). `strict` (a command) keeps the old rule: a set of many is refused whatever it holds.
 */
export function aliasSlotValue(key: string, slot: EntitySlot, resolved: ResolvedAliasValue, opts: { strict?: boolean } = {}): string | string[] {
  if (!resolved.heldBy && resolved.entityType !== null && !slot.entityTypes.includes(resolved.entityType)) {
    throw slotKindRefusal(key, resolved)
  }
  // A mixed set (a relations query) gives each slot the entities of the types it takes, never the others.
  const ids = resolved.refs.filter((r) => slot.entityTypes.includes(r.type)).map((r) => r.id)
  if (slot.multiple) return ids
  if (!resolved.multiple && !resolved.heldBy) {
    // A single alias that matched nothing leaves the slot empty; the query's own `required` decides.
    return ids[0] ?? ''
  }
  if (opts.strict) throw new AppError(`${MSG.ALIAS_RESOLVES_MANY}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
  if (ids.length === 1) return ids[0]
  if (resolved.heldBy) throw slotRefusal(ids.length === 0 ? 'holdsNone' : 'holdsMany', resolved, ids.length)
  // A parameter of many that matched nothing leaves the slot empty, as a single one does.
  if (ids.length === 0) return ''
  throw slotRefusal('givesMany', resolved, ids.length)
}

/**
 * Write-time check of one binding's `$alias` references against the board's aliases (E36-9) — the parts that do not
 * need a resolution: the alias exists, and (with the query's slots) the param is an entity slot and the alias gives an entity
 * the slot takes or one that holds such entities (D112). Whether a slot of one gets exactly one is the run time's rule
 * (`aliasSlotValue`): the editor asks it with the page's values and says it in the same words.
 */
export function assertAliasRefsKnown(
  params: Record<string, unknown>,
  aliases: readonly EntityAlias[] | null | undefined,
  slots?: Record<string, EntitySlot>,
  filters?: readonly { key: string }[] | null,
  /** Whether an entity of `type` can hand a slot of `slotTypes` the entities it holds (a relations contribution exists, D112). */
  holds?: (type: string, slotTypes: readonly string[]) => boolean,
): void {
  const byKey = new Map((aliases ?? []).map((a) => [a.key, a]))
  const filterKeys = new Set((filters ?? []).map((f) => f.key))
  for (const [key, value] of Object.entries(params)) {
    if (!isAliasRef(value)) continue
    const alias = byKey.get(value.$alias)
    if (!alias) throw new AppError(`${MSG.ALIAS_UNKNOWN}: '${value.$alias}'`, 422, ErrorCode.VALIDATION_ERROR)
    if (value.filter && !filterKeys.has(value.filter)) throw new AppError(`${MSG.FILTER_UNKNOWN}: '${value.filter}'`, 422, ErrorCode.VALIDATION_ERROR)
    if (!slots) continue
    const slot = Object.prototype.hasOwnProperty.call(slots, key) ? slots[key] : undefined
    if (!slot) throw new AppError(`${MSG.ALIAS_SLOT_INVALID}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
    const type = aliasEntityType(alias)
    // D112: an entity of another kind is taken when what it holds can be (a site for a slot of devices, `holds`); how many it holds,
    // and how many a parameter of many gives a slot of one, is known only at run time (`aliasSlotValue`).
    if (type !== null && !slot.entityTypes.includes(type) && !holds?.(type, slot.entityTypes)) {
      throw new AppError(`${MSG.ALIAS_SLOT_TYPE}: '${key}'`, 422, ErrorCode.VALIDATION_ERROR)
    }
  }
}

/** The viewer's current entity per single-resolve alias (E36-6), as a board context carries it (`a.<key>` in the URL). */
export const AliasEntitiesSchema = z
  .custom<Record<string, unknown>>(
    (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && !Object.prototype.hasOwnProperty.call(v, '__proto__'),
    'Invalid alias entities',
  )
  .pipe(z.record(BoardParamKeySchema, EntityIdSchema))
  .refine((r) => Object.keys(r).length <= MAX_BOARD_ALIASES, `At most ${MAX_BOARD_ALIASES} alias entities`)

/**
 * The aliases' board params exist (E36-7): a state entity names a param of the board, and a relation root that follows
 * a param needs that param to say what it identifies (`entityType`), since the walk starts from a typed entity. A 422
 * naming the alias otherwise.
 */
export function assertAliasParamsKnown(
  aliases: readonly EntityAlias[] | null | undefined,
  params: readonly { key: string; entityType?: string }[] | null | undefined,
): void {
  const byKey = new Map((params ?? []).map((p) => [p.key, p]))
  for (const a of aliases ?? []) {
    const f = a.filter
    const paramKey = f.type === 'stateEntity' ? f.param
      : (f.type === 'relationsQuery' || f.type === 'entitySearchQuery') && 'param' in f.root ? f.root.param : null
    if (paramKey === null) continue
    const p = byKey.get(paramKey)
    if (!p) throw new AppError(`${MSG.BOARD_PARAM_UNKNOWN}: '${paramKey}' (alias '${a.key}')`, 422, ErrorCode.VALIDATION_ERROR)
    if (f.type !== 'stateEntity' && !p.entityType) {
      throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${paramKey}' needs an entity type to root alias '${a.key}'`, 422, ErrorCode.VALIDATION_ERROR)
    }
  }
}

/** Every slot of a placement's binding names only the board's aliases (E36-9, a direct write). */
export function assertBindingAliasRefs(
  binding: Record<string, { params?: Record<string, unknown> } | null | undefined> | null | undefined,
  aliases: readonly EntityAlias[] | null | undefined,
  filters?: readonly { key: string }[] | null,
): void {
  for (const slot of Object.values(binding ?? {})) if (slot?.params) assertAliasRefsKnown(slot.params, aliases, undefined, filters)
}

/** How deep a `{ $alias }` may sit inside a stored action; an action is small, this only stops a cycle or a probe. */
const MAX_WALK_DEPTH = 8

/** Every alias reference inside a value (a placement's stored actions: a command's params, a `$map`'s `from`). */
export function collectAliasRefs(value: unknown, out: Array<{ $alias: string; filter?: string }> = [], depth = 0): Array<{ $alias: string; filter?: string }> {
  if (depth > MAX_WALK_DEPTH || value === null || typeof value !== 'object') return out
  if (isAliasRef(value)) { out.push(value); return out }
  for (const v of Array.isArray(value) ? value : Object.values(value)) collectAliasRefs(v, out, depth + 1)
  return out
}

/** The alias keys a placement references anywhere: its binding and its stored actions. */
export function placementAliasKeys(p: { dataBinding?: unknown; actions?: unknown }): Set<string> {
  const keys = referencedAliasKeys([p.dataBinding as never])
  for (const ref of collectAliasRefs(p.actions)) keys.add(ref.$alias)
  return keys
}

/** The filter keys a placement references anywhere (either reference form). */
export function placementFilterKeys(p: { dataBinding?: unknown; actions?: unknown }): Set<string> {
  const keys = referencedFilterKeys([p.dataBinding as never])
  const walk = (v: unknown, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || v === null || typeof v !== 'object') return
    const f = filterOfRef(v)
    if (f) { keys.add(f); return }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1)
  }
  walk(p.actions, 0)
  return keys
}
