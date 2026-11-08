import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import {
  BoardParamDefSchema, BoardParamKeySchema, MAX_BOARD_PARAMS, MAX_BOARD_PARAMS_TOTAL, PARAM_VIEWER_MODES,
  dependsOnIssues, isParamRef, valueParamIssues, validateParamValue, type BoardParamDef,
} from './board-window'
import {
  AliasRootSchema, ContributionKeySchema, EntityIdSchema, RelationTypeSchema, SubtypeSchema,
  MAX_ENTITY_LIST, MAX_NAME_PREFIX, MAX_RELATION_FILTERS, MAX_RELATION_LEVEL, MAX_SUBTYPES, aliasRefKey, isAliasRef,
  type EntityAlias, type EntityAliasFilter,
} from './board-aliases'

/**
 * Board parameters, one concept (docs/phases/07-dashboard/41, D41-1): a parameter is a VALUE (text, number, date, a fixed list,
 * the phase 10 field) or an ENTITY (a device, an asset…: an entity type and how the entity is chosen). The entity aliases of
 * phase 36 are retired as a separate list: everything an alias did, an entity parameter does, and a card names either kind
 * with `{ "$param": "<key>" }` (an entity parameter optionally through a board filter, `"filter": "<key>"`).
 *
 * Pure: schemas, the read normaliser (old params, old aliases and `{ $alias }` refs to the new shape, D41-7), the legacy
 * view the editor reads until it moves to this shape (41.2), and the value rules. Resolution needs the contributed entity
 * types and lives in `alias-resolver.ts` (`createParamResolver`).
 */

// ── the entity parameter ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a viewer's pick may be narrowed to (phase 41.3): the entities of some subtypes (a device profile), optionally by a name
 * prefix; the entities whose name starts with a text; or a fixed list. A pick outside it is refused when it resolves (422), as
 * a pick outside an alias's set always was, and before a query or a command takes it as a plain value.
 */
export const ViewerWithinSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subtype'), subtypes: z.array(SubtypeSchema).min(1).max(MAX_SUBTYPES),
    namePrefix: z.string().min(1).max(MAX_NAME_PREFIX).optional(),
  }).strict(),
  z.object({ type: z.literal('name'), namePrefix: z.string().min(1).max(MAX_NAME_PREFIX) }).strict(),
  z.object({ type: z.literal('list'), ids: z.array(EntityIdSchema).min(1).max(MAX_ENTITY_LIST) }).strict(),
])
export type ViewerWithin = z.infer<typeof ViewerWithinSchema>

/**
 * How an entity parameter's entity is chosen (D41-2). `viewer`: the viewer picks one of the type (the filter bar), inside
 * `within` when it is narrowed. `page`: a
 * link, a host or an action sets it (hidden; `param` = it is the value of another parameter, what a `stateEntity` alias read).
 * `single` / `list`: fixed. `all`, `name`, `subtype`: a set of the type. `related`: the entities related to another parameter's
 * entity or to a fixed one; with `filters` a relations query (it may mix types), without them a search query of the
 * parameter's own type (`relationType`, `subtypes`).
 */
export const EntityChoiceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('viewer'), within: ViewerWithinSchema.optional() }).strict(),
  z.object({ type: z.literal('page'), param: BoardParamKeySchema.optional() }).strict(),
  z.object({ type: z.literal('single'), id: EntityIdSchema }).strict(),
  z.object({ type: z.literal('list'), ids: z.array(EntityIdSchema).min(1).max(MAX_ENTITY_LIST) }).strict(),
  z.object({ type: z.literal('all') }).strict(),
  z.object({ type: z.literal('name'), namePrefix: z.string().min(1).max(MAX_NAME_PREFIX) }).strict(),
  z.object({
    type: z.literal('subtype'), subtypes: z.array(SubtypeSchema).min(1).max(MAX_SUBTYPES),
    namePrefix: z.string().min(1).max(MAX_NAME_PREFIX).optional(),
  }).strict(),
  z.object({
    type: z.literal('related'),
    provider: ContributionKeySchema,
    root: AliasRootSchema,
    direction: z.enum(['from', 'to']),
    maxLevel: z.number().int().min(1).max(MAX_RELATION_LEVEL),
    lastLevelOnly: z.boolean().optional(),
    relationType: RelationTypeSchema.optional(),
    subtypes: z.array(SubtypeSchema).max(MAX_SUBTYPES).optional(),
    filters: z.array(z.object({
      relationType: RelationTypeSchema.optional(),
      entityTypes: z.array(ContributionKeySchema).max(20).optional(),
      negate: z.boolean().optional(),
    }).strict()).max(MAX_RELATION_FILTERS).optional(),
  }).strict().refine((c) => !(c.filters && (c.relationType !== undefined || c.subtypes !== undefined)), {
    message: 'A relations query (filters) and a search query (relationType, subtypes) are not combined',
  }),
])
export type EntityChoice = z.infer<typeof EntityChoiceSchema>
export type EntityChoiceType = EntityChoice['type']

export const EntityParamDefSchema = z
  .object({
    kind: z.literal('entity'),
    key: BoardParamKeySchema,
    label: z.string().trim().min(1).max(80),
    description: z.string().max(240).optional(),
    /** The search box's hint in the filter bar. */
    placeholder: z.string().max(120).optional(),
    /** A contributed entity type (`dashboard:entity_type`). Absent only for a relations query, which may mix types. */
    entityType: ContributionKeySchema.optional(),
    choose: EntityChoiceSchema,
    /** One entity (absent) or every entity of the set. */
    multiple: z.boolean().optional(),
    /** The entity a single parameter starts with (chosen by name in the editor, stored by id); checked against the set. */
    default: EntityIdSchema.optional(),
    /** With no value and no default, take the first entity of the set by name (what an alias always did). */
    defaultFrom: z.literal('firstOption').optional(),
    /** The filter bar: `edit` (absent) a search box, `readOnly` the entity shown, `hidden` nothing. A `page` choice is hidden. */
    viewer: z.enum(PARAM_VIEWER_MODES).optional(),
    /** The filter bar asks for a pick (as a value parameter's `field.required`); an empty one is no value, as it is there. */
    required: z.boolean().optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    const c = p.choose
    if (p.entityType === undefined && !(c.type === 'related' && c.filters)) {
      ctx.addIssue({ code: 'custom', message: 'An entity parameter needs an entity type', path: ['entityType'] })
    }
    // TB: a single entity is one entity; choosing it "as many" means nothing.
    if (c.type === 'single' && p.multiple) ctx.addIssue({ code: 'custom', message: 'A single entity cannot be many', path: ['multiple'] })
    if (p.default !== undefined && (p.multiple || c.type === 'single')) {
      ctx.addIssue({ code: 'custom', message: 'Only a parameter of one entity chosen from a set has a default', path: ['default'] })
    }
    // A page choice that follows another parameter holds that parameter's entity: a stored default would be a second value of
    // it, refused (422) as soon as the followed parameter is picked differently.
    if (p.default !== undefined && c.type === 'page' && c.param !== undefined) {
      ctx.addIssue({ code: 'custom', message: 'A parameter that follows another one has no default of its own', path: ['default'] })
    }
    const listed = c.type === 'list' ? c.ids : c.type === 'viewer' && c.within?.type === 'list' ? c.within.ids : null
    if (p.default !== undefined && listed && !listed.includes(p.default)) {
      ctx.addIssue({ code: 'custom', message: 'The default is not one of the listed entities', path: ['default'] })
    }
    if (c.type === 'page' && c.param === p.key) ctx.addIssue({ code: 'custom', message: 'A parameter cannot take its value from itself', path: ['choose', 'param'] })
  })
export type EntityParamDef = z.infer<typeof EntityParamDefSchema>

/** A value parameter: the phase 10 definition; `kind` may be left out (a parameter stored before phase 41 is one). */
export const ValueParamDefSchema = BoardParamDefSchema.extend({ kind: z.literal('value').optional() }).strict()
export type ValueParamDef = BoardParamDef & { kind?: 'value' }

export type BoardParam = ValueParamDef | EntityParamDef

export const BoardParamSchema = z.union([EntityParamDefSchema, ValueParamDefSchema])

export const isEntityParam = (p: { kind?: unknown } | null | undefined): p is EntityParamDef => p?.kind === 'entity'
export const isValueParam = (p: { kind?: unknown } | null | undefined): p is ValueParamDef => !!p && p.kind !== 'entity'

/**
 * A board's parameters as one list (D41-8): at most 48 (the 16 parameters and the 32 aliases of the two lists it replaces), at
 * most 16 of them values, unique keys, each value parameter's own rules, and `dependsOn` naming another parameter without a
 * cycle. What an entity parameter reads of another (a page value, a relation root) is checked by `entityParamRefIssues`, the
 * 422 of a write (E36-7), so a list read back from a package or a template can be checked the same way.
 */
export const BoardParamListSchema = z
  .array(BoardParamSchema)
  .max(MAX_BOARD_PARAMS_TOTAL)
  .superRefine((defs, ctx) => {
    const seen = new Set<string>()
    let values = 0
    defs.forEach((d, i) => {
      if (seen.has(d.key)) ctx.addIssue({ code: 'custom', message: 'Duplicate parameter key', path: [i, 'key'] })
      seen.add(d.key)
      if (isEntityParam(d)) return
      values += 1
      for (const issue of valueParamIssues(d)) ctx.addIssue({ code: 'custom', message: issue.message, path: [i, issue.field] })
    })
    if (values > MAX_BOARD_PARAMS) ctx.addIssue({ code: 'custom', message: `At most ${MAX_BOARD_PARAMS} value parameters`, path: [] })
    for (const issue of dependsOnIssues(defs.map((d) => (isEntityParam(d) ? { key: d.key } : d)))) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: [issue.index, 'dependsOn'] })
    }
  })

/**
 * A parameter list as a write, a package or a template sends it (D41-7): items of either age, an old entity `remote-select`
 * read as the entity parameter it is (`normalizeBoardParams`, keys never renamed: a clash is the list's 400), then the list's
 * rules. The output is the new shape only.
 */
export const BoardParamsInputSchema = z
  .array(z.custom<Record<string, unknown>>((v) => isObj(v), 'Invalid parameter'))
  .max(MAX_BOARD_PARAMS_TOTAL)
  .transform((items) => normalizeBoardParams({ params: items }, { renameClashes: false }).params)
  .pipe(BoardParamListSchema)

/** The parameter another one reads: a page value (`choose.page.param`) or a relation root (`choose.related.root.param`). */
export function entityParamSource(p: EntityParamDef): { key: string; root: boolean } | null {
  const c = p.choose
  if (c.type === 'page' && c.param) return { key: c.param, root: false }
  if (c.type === 'related' && 'param' in c.root) return { key: c.root.param, root: true }
  return null
}

/**
 * What an entity parameter reads of the others, checked on the whole list (E36-7): the parameter exists; a relation root is
 * one entity of a known type (an entity parameter of one entity, or a value parameter that says its `entityType`); a page
 * choice follows one entity (phase 41: an entity parameter it follows is resolved first, its pick checked against its set);
 * and following entity parameters, by roots or page choices, never comes back. By index into `defs`.
 */
export function entityParamRefIssues(defs: readonly BoardParam[]): Array<{ index: number; key: string; message: string }> {
  const out: Array<{ index: number; key: string; message: string }> = []
  const byKey = new Map(defs.map((d) => [d.key, d]))
  defs.forEach((d, i) => {
    if (!isEntityParam(d)) return
    const src = entityParamSource(d)
    if (!src) return
    const target = byKey.get(src.key)
    if (!target || src.key === d.key) { out.push({ index: i, key: d.key, message: `'${src.key}' is not another parameter of this board` }); return }
    if (src.root && (isEntityParam(target) ? target.multiple === true || !target.entityType : !target.entityType)) {
      out.push({ index: i, key: d.key, message: `'${src.key}' must be one entity of a known type to root a relation` })
      return
    }
    if (!src.root && isEntityParam(target) && target.multiple === true) {
      out.push({ index: i, key: d.key, message: `'${src.key}' must be one entity to give a page its value` })
      return
    }
    const chain = new Set([d.key])
    for (let at: BoardParam | undefined = target; at && isEntityParam(at);) {
      if (chain.has(at.key)) { out.push({ index: i, key: d.key, message: 'The parameters it follows make a cycle' }); return }
      chain.add(at.key)
      const next = entityParamSource(at)
      at = next ? byKey.get(next.key) : undefined
    }
  })
  return out
}

/** The list's references, as the 422 a write answers (E36-7). */
export function assertEntityParamRefs(defs: readonly BoardParam[] | null | undefined): void {
  const issue = entityParamRefIssues(defs ?? [])[0]
  if (issue) throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${issue.key}': ${issue.message}`, 422, ErrorCode.VALIDATION_ERROR)
}

/**
 * The entity parameters the toolbar entity select offers (TB, E36-6; the board-open answer lists exactly these, D40-12): one
 * entity chosen from a set, not fixed, and not one the editor shows as a parameter (a viewer or page pick has its own picker
 * until the filter bar takes both, 41.3).
 */
export const selectableEntityParams = (params: readonly BoardParam[]): EntityParamDef[] =>
  params.filter(isEntityParam).filter((p) => !p.multiple && p.choose.type !== 'single' && !isLegacyValueParam(p))

/** The parameters entity parameters read (a page value, a relation root): they may not be removed while one does. */
export function entityParamReadKeys(defs: readonly BoardParam[] | null | undefined): Set<string> {
  const out = new Set<string>()
  for (const d of defs ?? []) if (isEntityParam(d)) { const s = entityParamSource(d); if (s) out.add(s.key) }
  return out
}

// ── the old shapes (D41-7) ───────────────────────────────────────────────────────────────────────────────────────────

/** The dashboard's own entity list (`GET …/dashboard/entity-types/<key>/entities`), what an entity-type remote-select calls. */
export const entityListPath = (entityType: string): string => `/api/dashboard/entity-types/${encodeURIComponent(entityType)}/entities`
const ENTITY_LIST_PATH = /^\/api\/dashboard\/entity-types\/([a-z][a-z0-9_.-]{0,59})\/entities$/

/**
 * The module lists an old `remote-select` named before the dashboard had its own (phase 17, INC-04), each with the key of its
 * answer that IS the entity id the entity type answers by. Read-side compatibility only: nothing writes these paths any more.
 */
const LEGACY_ENTITY_LISTS: Readonly<Record<string, { entityType: string; valueKey: string }>> = {
  '/api/iot/devices': { entityType: 'iot_device', valueKey: 'deviceId' },
  '/api/iot/assets': { entityType: 'iot_asset', valueKey: 'iotAssetId' },
  '/api/iot/device-profiles': { entityType: 'iot_device_profile', valueKey: 'profileId' },
}

/**
 * The entity type a list of `path` gives, read by `valueKey`; else null. A field that leaves the key out (INC-04 filled the keys
 * from the entity type, so none was stored) reads the dashboard's own list by `id` (the picker's default), and a module's list by
 * its own key when the parameter names that list's entity type (`entityType`, INC-20).
 */
function entityListOf(path: string, valueKey: unknown, entityType: unknown): string | null {
  const own = ENTITY_LIST_PATH.exec(path)
  if (own) return valueKey === 'id' || valueKey === undefined ? own[1] : null
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_ENTITY_LISTS, path) ? LEGACY_ENTITY_LISTS[path] : null
  if (!legacy) return null
  return valueKey === legacy.valueKey || (valueKey === undefined && entityType === legacy.entityType) ? legacy.entityType : null
}

/**
 * The entity type a `remote-select` lists, when its endpoint is a known entity list read by the entity's id; else null.
 * `entityType` is the parameter's own (`BoardParamDef.entityType`): with it, a field without a `valueKey` is read too.
 */
export function knownEntityList(field: { endpoint?: unknown; valueKey?: unknown }, entityType?: unknown): string | null {
  if (typeof field.endpoint !== 'string') return null
  return entityListOf(field.endpoint, field.valueKey, entityType)
}

/**
 * The queries an old module list was narrowed by, and what each is to the entity type (phase 41.3, INC-20): `deviceProfileId`
 * on the device list is a device's profile, the `iot_device` entity type's subtype. Read-side compatibility only.
 */
const LEGACY_LIST_NARROWINGS: Readonly<Record<string, Readonly<Record<string, 'subtype'>>>> = {
  '/api/iot/devices': { deviceProfileId: 'subtype' },
}

/** An old list narrowed by a query (`/api/iot/devices?deviceProfileId=<id>`): its entity type, and the one query it is narrowed by. */
export interface NarrowedEntityList { entityType: string; query: string; value: string; as: 'subtype' }

/**
 * The narrowed module list a `remote-select` names, else null: a known list read by the entity's id (`knownEntityList`'s rule)
 * with exactly one query, a narrowing that list is known for, holding one subtype. Anything else (another query, two, an empty
 * value) is a list the entity choice cannot say, and stays a value parameter.
 */
export function narrowedEntityList(field: { endpoint?: unknown; valueKey?: unknown }, entityType?: unknown): NarrowedEntityList | null {
  if (typeof field.endpoint !== 'string') return null
  const at = field.endpoint.indexOf('?')
  if (at < 0) return null
  const path = field.endpoint.slice(0, at)
  const narrowings = Object.prototype.hasOwnProperty.call(LEGACY_LIST_NARROWINGS, path) ? LEGACY_LIST_NARROWINGS[path] : null
  const type = narrowings ? entityListOf(path, field.valueKey, entityType) : null
  if (!narrowings || !type) return null
  const query = [...new URLSearchParams(field.endpoint.slice(at + 1))]
  if (query.length !== 1) return null
  const [name, value] = query[0]
  if (!Object.prototype.hasOwnProperty.call(narrowings, name) || !SubtypeSchema.safeParse(value).success) return null
  return { entityType: type, query: name, value, as: narrowings[name] }
}

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const isEntityId = (v: unknown): v is string => EntityIdSchema.safeParse(v).success

/**
 * An old value parameter that picks an entity of a known list (a `remote-select` of `/api/iot/devices`, of the dashboard's entity
 * list) as the entity parameter it is: `viewer` when the filter bar shows it, `page` when it is hidden. A `multi-select` of such a
 * list (what the legacy view shows a viewer's pick of many as) is the viewer's pick of many; hidden, or with a default, it stays.
 * A list narrowed by a query (`narrowedEntityList`) becomes one only with `narrowed` given: hidden it is set by the page (no
 * narrowing), shown it is the viewer's pick inside `narrowed.within`, which the caller resolved from the query (the post-deploy
 * step: the profile id is checked against the database); the read normaliser passes none, so such a list stays as it is. One
 * that depends on another parameter, or names an entity type the list does not list, stays a value parameter. Pure; null = it
 * stays as it is.
 */
export function valueParamAsEntity(def: Obj, narrowed?: { within?: ViewerWithin }): EntityParamDef | null {
  const field = isObj(def.field) ? def.field : null
  const many = field?.type === 'multi-select'
  if (!field || (field.type !== 'remote-select' && !many) || def.dependsOn !== undefined || typeof def.key !== 'string' || typeof def.label !== 'string') return null
  const hidden = def.viewer === 'hidden'
  let entityType = knownEntityList(field, def.entityType)
  let within: ViewerWithin | undefined
  if (!entityType) {
    const n = narrowed ? narrowedEntityList(field, def.entityType) : null
    if (!n || (!hidden && !narrowed?.within)) return null
    entityType = n.entityType
    within = hidden ? undefined : narrowed?.within
  }
  if (def.entityType !== undefined && def.entityType !== entityType) return null
  if (many && (hidden || (def.default !== undefined && !(Array.isArray(def.default) && def.default.length === 0)))) return null
  return {
    kind: 'entity', key: def.key, label: def.label, entityType,
    choose: hidden ? { type: 'page' } : within ? { type: 'viewer', within } : { type: 'viewer' },
    ...(many ? { multiple: true } : {}),
    ...(!hidden && def.viewer === 'readOnly' ? { viewer: 'readOnly' as const } : {}),
    ...(typeof field.description === 'string' ? { description: field.description } : {}),
    ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}),
    ...(field.required === true ? { required: true } : {}),
    ...(!many && isEntityId(def.default) && withinHolds(within, def.default) ? { default: def.default } : {}),
    ...(!many && def.defaultFrom === 'firstOption' ? { defaultFrom: 'firstOption' as const } : {}),
  }
}

/** A default an old field kept is kept only where a listed narrowing holds it (the schema's rule); a subtype or a name is the resolver's. */
const withinHolds = (within: ViewerWithin | undefined, id: string): boolean => within?.type !== 'list' || within.ids.includes(id)

/**
 * The old value parameters of `params` that pick an entity of a narrowed module list, as the entity parameters they are (phase
 * 41.3, INC-20; `valueParamAsEntity` with `narrowed`): `within` says what each narrowing is, null when it could not be resolved
 * (an unknown profile: the parameter stays as it is). Hidden ones need no narrowing and are converted without asking. Pure.
 */
export function withNarrowedLists(
  params: readonly BoardParam[],
  within: (list: NarrowedEntityList) => ViewerWithin | null,
): { params: BoardParam[]; changed: boolean } {
  let changed = false
  const out = params.map((p) => {
    if (isEntityParam(p)) return p
    const n = narrowedEntityList(p.field, p.entityType)
    if (!n) return p
    const hidden = p.viewer === 'hidden'
    const w = hidden ? null : within(n)
    if (!hidden && !w) return p
    const entity = valueParamAsEntity(p as unknown as Obj, w ? { within: w } : {})
    if (!entity) return p
    changed = true
    return entity
  })
  return { params: out, changed }
}

type Related = Extract<EntityChoice, { type: 'related' }>

/** The choice an old alias filter is. */
function choiceOfFilter(f: Obj): { choose: EntityChoice; entityType?: string } | null {
  const entityType = typeof f.entityType === 'string' ? f.entityType : undefined
  switch (f.type) {
    case 'singleEntity': return { choose: { type: 'single', id: f.id as string }, entityType }
    case 'entityList': return { choose: { type: 'list', ids: f.ids as string[] }, entityType }
    case 'entityName': return { choose: { type: 'name', namePrefix: f.namePrefix as string }, entityType }
    case 'entityType': return { choose: { type: 'all' }, entityType }
    case 'stateEntity': return { choose: { type: 'page', param: f.param as string }, entityType }
    case 'entitySubtype':
      return { choose: { type: 'subtype', subtypes: f.subtypes as string[], ...(f.namePrefix !== undefined ? { namePrefix: f.namePrefix as string } : {}) }, entityType }
    case 'relationsQuery':
    case 'entitySearchQuery': {
      const walk = {
        type: 'related' as const, provider: f.provider as string, root: f.root as Related['root'],
        direction: f.direction as 'from' | 'to', maxLevel: f.maxLevel as number,
        ...(f.lastLevelOnly !== undefined ? { lastLevelOnly: f.lastLevelOnly as boolean } : {}),
      }
      if (f.type === 'relationsQuery') return { choose: { ...walk, filters: (f.filters ?? []) as NonNullable<Related['filters']> } }
      return {
        choose: {
          ...walk,
          ...(f.relationType !== undefined ? { relationType: f.relationType as string } : {}),
          ...(f.subtypes !== undefined ? { subtypes: f.subtypes as string[] } : {}),
        },
        entityType,
      }
    }
    default: return null
  }
}

/**
 * An old alias as the entity parameter it is, under `key`: its name is the label, `resolveMultiple` is `multiple`, its filter
 * the choice. A single one takes the first entity by name with no pick (TB, the alias rule); a set the viewer could not pick from
 * (many, or one fixed entity) is hidden from the filter bar. Pure; null = not an alias.
 */
export function aliasAsEntityParam(alias: Obj, key: string): EntityParamDef | null {
  if (!isObj(alias.filter) || typeof alias.name !== 'string') return null
  const mapped = choiceOfFilter(alias.filter)
  if (!mapped) return null
  const multiple = alias.resolveMultiple === true
  const fixed = mapped.choose.type === 'single'
  return {
    kind: 'entity', key, label: alias.name,
    ...(mapped.entityType !== undefined ? { entityType: mapped.entityType } : {}),
    choose: mapped.choose,
    ...(multiple ? { multiple: true } : {}),
    ...(!multiple && !fixed ? { defaultFrom: 'firstOption' as const } : {}),
    ...(multiple || fixed ? { viewer: 'hidden' as const } : {}),
  }
}

/** A key not in `taken`, made from `key` (`device` → `device_2`), within the key rules. */
function freeKey(key: string, taken: ReadonlySet<string>): string {
  for (let n = 2; ; n += 1) {
    const candidate = `${key.slice(0, 39 - String(n).length)}_${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export interface NormalizedParams {
  params: BoardParam[]
  /** Old alias key → the key of the entity parameter it became (the same key unless it clashed with a parameter's). */
  aliasKeys: Record<string, string>
  /** Something was converted: the stored row is in an old shape. */
  changed: boolean
}

/**
 * The read normaliser (D41-7): a board's stored `params` and `aliases` (any age) as one parameter list. An old value parameter
 * stays one, except a `remote-select` of a known entity list (`valueParamAsEntity`); every alias becomes an entity parameter of
 * the same key. A key an alias shares with a parameter is given a free one when `renameClashes` (a stored row: its cards are
 * rewritten through `aliasKeys`); without it the clash is kept, for the write's schema to refuse. Never throws: a stored row was
 * validated when written, and an item of no known shape is left as it is.
 */
export function normalizeBoardParams(
  raw: { params?: unknown; aliases?: unknown },
  opts: { renameClashes?: boolean } = {},
): NormalizedParams {
  const renameClashes = opts.renameClashes ?? true
  const params: BoardParam[] = []
  let changed = false
  for (const item of Array.isArray(raw.params) ? raw.params : []) {
    if (!isObj(item)) { changed = true; continue }
    const entity = item.kind === undefined || item.kind === 'value' ? valueParamAsEntity(item) : null
    if (entity) changed = true
    params.push((entity ?? item) as BoardParam)
  }
  const aliasKeys: Record<string, string> = {}
  const aliases = (Array.isArray(raw.aliases) ? raw.aliases : []).filter((a): a is Obj => isObj(a) && typeof a.key === 'string')
  const taken = new Set(params.map((p) => p.key))
  // A renamed alias never takes the key another alias of the list has (`x` → `x_2` while an alias `x_2` exists): its cards'
  // `{ $alias: 'x_2' }` would follow the wrong one.
  const reserved = new Set([...taken, ...aliases.map((a) => a.key as string)])
  for (const alias of aliases) {
    changed = true
    const key = renameClashes && taken.has(alias.key as string) ? freeKey(alias.key as string, reserved) : alias.key as string
    const param = aliasAsEntityParam(alias, key)
    if (!param) continue
    aliasKeys[alias.key as string] = key
    taken.add(key)
    reserved.add(key)
    params.push(param)
  }
  return { params, aliasKeys, changed }
}

/** How deep a reference may sit in a stored binding or action; they are small, this only stops a cycle or a probe. */
const MAX_REF_DEPTH = 10

/**
 * Every `{ $alias: key, filter? }` inside `value` as `{ $param: <its parameter's key>, filter? }` (D41-7): a placement's binding
 * and its stored actions. A new object only where something changed; `changed` says whether anything did.
 */
export function normalizeParamRefs<T>(value: T, aliasKeys: Readonly<Record<string, string>> = {}): { value: T; changed: boolean } {
  let changed = false
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > MAX_REF_DEPTH || v === null || typeof v !== 'object') return v
    if (isObj(v) && typeof v.$alias === 'string' && Object.keys(v).every((k) => k === '$alias' || k === 'filter')) {
      changed = true
      const key = Object.prototype.hasOwnProperty.call(aliasKeys, v.$alias) ? aliasKeys[v.$alias] : v.$alias
      return { $param: key, ...(typeof v.filter === 'string' ? { filter: v.filter } : {}) }
    }
    let copy: unknown[] | Obj | null = null
    const entries = Array.isArray(v) ? v.map((x, i) => [i, x] as const) : Object.entries(v)
    for (const [k, x] of entries) {
      const next = walk(x, depth + 1)
      if (next === x) continue
      copy ??= Array.isArray(v) ? [...v] : { ...v }
      ;(copy as Record<string | number, unknown>)[k] = next
    }
    return copy ?? v
  }
  const out = walk(value, 0) as T
  return { value: out, changed }
}

/** A placement's binding and actions with their references in the new shape (D41-7). */
export function normalizePlacementRefs<P extends { dataBinding?: unknown; actions?: unknown }>(
  placement: P,
  aliasKeys: Readonly<Record<string, string>> = {},
): { placement: P; changed: boolean } {
  const binding = normalizeParamRefs(placement.dataBinding, aliasKeys)
  const actions = normalizeParamRefs(placement.actions, aliasKeys)
  if (!binding.changed && !actions.changed) return { placement, changed: false }
  return { placement: { ...placement, dataBinding: binding.value, actions: actions.value }, changed: true }
}

/**
 * A placement's binding and stored actions name only the board's entity parameters and filters (E36-9, both reference forms):
 * an old `{ $alias }` names one (through `aliasKeys`), a `{ $param }` with a board filter names an entity parameter, and the
 * filter is the board's. A 422 otherwise. Run on what a write sends, before `normalizePlacementRefs` stores the new form; a
 * plain `{ $param }` is the query's to judge, as it always was.
 */
export function assertPlacementEntityRefs(
  placement: { dataBinding?: unknown; actions?: unknown },
  params: readonly BoardParam[] | null | undefined,
  filters: readonly { key: string }[] | null | undefined,
  aliasKeys: Readonly<Record<string, string>> = {},
): void {
  const entities = new Set((params ?? []).filter(isEntityParam).map((p) => p.key))
  const filterKeys = new Set((filters ?? []).map((f) => f.key))
  const walk = (v: unknown, depth: number): void => {
    if (depth > MAX_REF_DEPTH || v === null || typeof v !== 'object') return
    if (isObj(v) && typeof v.$alias === 'string' && Object.keys(v).every((k) => k === '$alias' || k === 'filter')) {
      const key = Object.prototype.hasOwnProperty.call(aliasKeys, v.$alias) ? aliasKeys[v.$alias] : v.$alias
      if (!entities.has(key)) throw new AppError(`${MSG.ALIAS_UNKNOWN}: '${v.$alias}'`, 422, ErrorCode.VALIDATION_ERROR)
      if (typeof v.filter === 'string' && !filterKeys.has(v.filter)) throw new AppError(`${MSG.FILTER_UNKNOWN}: '${v.filter}'`, 422, ErrorCode.VALIDATION_ERROR)
      return
    }
    if (isObj(v) && typeof v.$param === 'string' && typeof v.filter === 'string' && Object.keys(v).every((k) => k === '$param' || k === 'filter')) {
      if (!entities.has(v.$param)) throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${v.$param}'`, 422, ErrorCode.VALIDATION_ERROR)
      if (!filterKeys.has(v.filter)) throw new AppError(`${MSG.FILTER_UNKNOWN}: '${v.filter}'`, 422, ErrorCode.VALIDATION_ERROR)
      return
    }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x, depth + 1)
  }
  walk(placement.dataBinding, 0)
  walk(placement.actions, 0)
}

// ── the legacy view (until 41.2) ─────────────────────────────────────────────────────────────────────────────────────

/** The alias filter an entity parameter's choice is (the resolver's working form, and the editor's legacy view). */
export function entityParamFilter(p: EntityParamDef): EntityAliasFilter {
  const c = p.choose
  const entityType = p.entityType ?? ''
  switch (c.type) {
    case 'viewer': {
      // A narrowed pick is checked against the set it is narrowed to, as an alias's pick is against its own.
      const w = c.within
      if (w?.type === 'subtype') return { type: 'entitySubtype', entityType, subtypes: w.subtypes, ...(w.namePrefix !== undefined ? { namePrefix: w.namePrefix } : {}) }
      if (w?.type === 'name') return { type: 'entityName', entityType, namePrefix: w.namePrefix }
      if (w?.type === 'list') return { type: 'entityList', entityType, ids: w.ids }
      return { type: 'entityType', entityType }
    }
    case 'all': return { type: 'entityType', entityType }
    case 'page': return c.param ? { type: 'stateEntity', entityType, param: c.param } : { type: 'entityType', entityType }
    case 'single': return { type: 'singleEntity', entityType, id: c.id }
    case 'list': return { type: 'entityList', entityType, ids: c.ids }
    case 'name': return { type: 'entityName', entityType, namePrefix: c.namePrefix }
    case 'subtype': return { type: 'entitySubtype', entityType, subtypes: c.subtypes, ...(c.namePrefix !== undefined ? { namePrefix: c.namePrefix } : {}) }
    case 'related': {
      const walk = {
        provider: c.provider, root: c.root, direction: c.direction, maxLevel: c.maxLevel,
        ...(c.lastLevelOnly !== undefined ? { lastLevelOnly: c.lastLevelOnly } : {}),
      }
      if (c.filters) return { type: 'relationsQuery', ...walk, filters: c.filters }
      return {
        type: 'entitySearchQuery', ...walk, entityType,
        ...(c.relationType !== undefined ? { relationType: c.relationType } : {}),
        ...(c.subtypes !== undefined ? { subtypes: c.subtypes } : {}),
      }
    }
  }
}

/** The entity parameter as the alias the resolver works on (the same key). */
export function entityParamAlias(p: EntityParamDef): EntityAlias {
  return { key: p.key, name: p.label, resolveMultiple: p.multiple === true, filter: entityParamFilter(p) }
}

/**
 * Is the parameter, in the legacy view, a parameter (a value one, or the entities the viewer or the page sets, shown as the
 * entity-type `remote-select` INC-04 made, a `multi-select` for the viewer's pick of many) rather than an alias? A parameter's
 * value is the viewer's in the URL (`p.<key>`), an alias's pick is `a.<key>` (phase 36).
 */
export function isLegacyValueParam(p: BoardParam): boolean {
  if (!isEntityParam(p)) return true
  return p.entityType !== undefined
    && (p.choose.type === 'viewer' || (p.choose.type === 'page' && !p.choose.param && p.multiple !== true))
}

/** An entity parameter the viewer or the page sets, as the entity-type `remote-select` the editor knows (`isLegacyValueParam`). */
function asLegacyRemoteSelect(p: EntityParamDef): BoardParamDef {
  const hidden = p.choose.type === 'page'
  return {
    key: p.key, label: p.label, entityType: p.entityType,
    field: {
      // the list the field names carries the entity type only: what the viewer may pick is the parameter's (`within`)
      label: p.label, type: p.multiple ? 'multi-select' : 'remote-select', endpoint: entityListPath(p.entityType ?? ''),
      dataKey: 'data', labelKey: 'name', valueKey: 'id', searchKey: 'search', lookupKey: 'ids',
      ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.placeholder !== undefined ? { placeholder: p.placeholder } : {}),
      ...(p.required ? { required: true } : {}),
    },
    ...(p.default !== undefined ? { default: p.default } : {}),
    ...(p.defaultFrom ? { defaultFrom: p.defaultFrom } : {}),
    ...(hidden ? { viewer: 'hidden' as const } : p.viewer && p.viewer !== 'edit' ? { viewer: p.viewer } : {}),
  }
}

/**
 * The list as the two the editor still edits until 41.2: the parameters (values, and the entities the viewer or the page sets)
 * and the aliases (every other entity parameter, by the same key). `normalizeBoardParams` turns the pair back into the list.
 */
export function legacyParamView(params: readonly BoardParam[] | null | undefined): { params: BoardParamDef[]; aliases: EntityAlias[] } {
  const out: { params: BoardParamDef[]; aliases: EntityAlias[] } = { params: [], aliases: [] }
  for (const p of params ?? []) {
    if (!isEntityParam(p)) {
      const def: ValueParamDef = { ...p }
      delete def.kind
      out.params.push(def)
    } else if (isLegacyValueParam(p)) {
      out.params.push(asLegacyRemoteSelect(p))
    } else {
      out.aliases.push(entityParamAlias(p))
    }
  }
  return out
}

/**
 * The entity parameters a card's entity slot may name in the editor (the widget drawer's "Use an entity alias", `{ $alias }`) beyond
 * the legacy view's aliases: the viewer's picks of many, which the view shows as parameters since 41.3 (a `multi-select` carrier)
 * and which only a slot of many takes (a plain value refuses many). The server resolves every entity parameter by key.
 */
export function legacyBindableExtras(params: readonly BoardParam[] | null | undefined): EntityAlias[] {
  return (params ?? []).filter(isEntityParam).filter((p) => p.multiple === true && isLegacyValueParam(p)).map(entityParamAlias)
}

/** A value as text with its object keys sorted (and `undefined` left out), so two equal items compare equal whatever their key order. */
function canonical(v: unknown): string {
  const walk = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(walk)
    if (!isObj(x)) return x
    return Object.fromEntries(Object.keys(x).sort().filter((k) => x[k] !== undefined).map((k) => [k, walk(x[k])]))
  }
  return JSON.stringify(walk(v)) ?? ''
}

/**
 * The pair the legacy view sends back (`params`, `aliases`) as the one list (D41-7), against the list it was shown from: an item
 * the view sends exactly as it showed it is the parameter it was, so what the view cannot say (a viewer pick of many, a default
 * on a list, a description, a filter-bar mode) survives a save of something else; an item it changed or added is read as the old
 * shape it is (`normalizeBoardParams`). Not renamed: a key both lists use is the list schema's 400.
 */
export function fromLegacyView(
  current: readonly BoardParam[] | null | undefined,
  view: { params?: unknown; aliases?: unknown },
): BoardParam[] {
  const shown = legacyParamView(current)
  const was = new Map<string, string>([
    ...shown.params.map((p) => [`p:${p.key}`, canonical(p)] as const),
    ...shown.aliases.map((a) => [`a:${a.key}`, canonical(a)] as const),
  ])
  const shownParams = new Map(shown.params.map((p) => [p.key, p]))
  const byKey = new Map((current ?? []).map((p) => [p.key, p]))
  const out: BoardParam[] = []
  const take = (tag: 'p' | 'a', item: unknown): void => {
    const key = isObj(item) && typeof item.key === 'string' ? item.key : null
    const before = key !== null ? was.get(`${tag}:${key}`) : undefined
    const kept = before !== undefined && before === canonical(item) ? byKey.get(key!) : undefined
    if (kept) { out.push(kept); return }
    // "Save as default" changes an entity parameter's default only: the parameter stays what it was (its narrowing, its count),
    // with the new default where it can hold one.
    const entity = tag === 'p' && key !== null ? byKey.get(key) : undefined
    const view = key !== null ? shownParams.get(key) : undefined
    if (entity && isEntityParam(entity) && view && isObj(item) && canonical({ ...view, default: undefined }) === canonical({ ...item, default: undefined })) {
      out.push(withEntityDefault(entity, item.default))
      return
    }
    out.push(...normalizeBoardParams(tag === 'p' ? { params: [item] } : { aliases: [item] }, { renameClashes: false }).params)
  }
  for (const item of Array.isArray(view.params) ? view.params : []) take('p', item)
  for (const item of Array.isArray(view.aliases) ? view.aliases : []) take('a', item)
  return out
}

/** An entity parameter with the default the legacy view sent: none for an empty one, kept as it was where it cannot hold one. */
function withEntityDefault(p: EntityParamDef, raw: unknown): EntityParamDef {
  const next: EntityParamDef = { ...p }
  delete next.default
  if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) return next
  const takes = !p.multiple && p.choose.type !== 'single' && !(p.choose.type === 'page' && p.choose.param)
  return takes && isEntityId(raw) ? { ...next, default: raw } : p
}

/**
 * An old `aliases` write (an API caller of phase 36): the aliases replace the entity parameters the legacy view shows as aliases,
 * the rest of the list stays; an alias sent back as the view shows it keeps its parameter (`fromLegacyView`). Not renamed: a key
 * an alias shares with a parameter is refused by the list's schema.
 */
export function withLegacyAliases(current: readonly BoardParam[] | null | undefined, aliases: readonly unknown[] | null): BoardParam[] {
  const kept = (current ?? []).filter(isLegacyValueParam)
  return [...kept, ...fromLegacyView(current, { aliases: aliases ?? [] })]
}

// ── values ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** An entity parameter's value as given: one id, or (many) a list or a comma-separated text of ids; null when it is not one. */
export function entityParamValue(p: EntityParamDef, raw: unknown): string | string[] | null {
  if (p.multiple) {
    const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',').map((s) => s.trim()).filter((s) => s !== '') : null
    if (!list || list.length > MAX_ENTITY_LIST || !list.every(isEntityId)) return null
    return [...new Set(list as string[])]
  }
  const id = typeof raw === 'string' ? raw.trim() : raw
  return isEntityId(id) ? id : null
}

/**
 * The effective parameter values (the phase 10 rule, both kinds): board defaults, then the viewer's overrides on top. A key the
 * board does not define is a 400; a value its parameter refuses a 422. An entity parameter's value is its id(s) as given, the
 * shape checked here and the entity checked when it resolves (it must be one of the set, of the tenant, readable).
 */
export function resolveBoardParamValues(
  defs: readonly BoardParam[] | null | undefined,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const list = defs ?? []
  const byKey = new Map(list.map((d) => [d.key, d]))
  for (const key of Object.keys(overrides ?? {})) {
    if (!byKey.has(key)) throw new AppError(`${MSG.BOARD_PARAM_UNKNOWN}: '${key}'`, 400, ErrorCode.VALIDATION_ERROR)
  }
  const out: Record<string, unknown> = {}
  for (const def of list) {
    const given = !!overrides && Object.prototype.hasOwnProperty.call(overrides, def.key)
    const raw = given ? overrides![def.key] : def.default
    if (isEntityParam(def)) {
      // An empty pick is no value, as for a value parameter (required or not): only the cards that read it answer, not the board.
      if (raw === undefined || raw === null || raw === '' || (Array.isArray(raw) && raw.length === 0)) continue
      const value = entityParamValue(def, raw)
      if (value === null) throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${def.key}'`, 422, ErrorCode.VALIDATION_ERROR)
      out[def.key] = value
      continue
    }
    if (raw === undefined || raw === null || raw === '') continue
    const checked = validateParamValue(def, raw)
    if (!checked.ok) throw new AppError(`${MSG.BOARD_PARAM_INVALID}: '${def.key}'`, 422, ErrorCode.VALIDATION_ERROR)
    out[def.key] = checked.value
  }
  return out
}

/**
 * The viewer's overrides with an old client's `aliasEntities` (`a.<key>`, phase 36) taken in: each pick of a single entity
 * parameter that the overrides do not already set. An alias key is followed to its parameter; one that names no single entity
 * parameter is ignored, as an alias the board did not define always was.
 */
export function withAliasEntities(
  defs: readonly BoardParam[],
  overrides: Record<string, unknown> | undefined,
  aliasEntities: Record<string, string> | undefined,
  aliasKeys: Readonly<Record<string, string>> = {},
): Record<string, unknown> | undefined {
  if (!aliasEntities || Object.keys(aliasEntities).length === 0) return overrides
  const out: Record<string, unknown> = { ...(overrides ?? {}) }
  const byKey = new Map(defs.map((d) => [d.key, d]))
  for (const [aliasKey, id] of Object.entries(aliasEntities)) {
    const key = Object.prototype.hasOwnProperty.call(aliasKeys, aliasKey) ? aliasKeys[aliasKey] : aliasKey
    const def = byKey.get(key)
    if (!def || !isEntityParam(def) || def.multiple || Object.prototype.hasOwnProperty.call(out, key)) continue
    out[key] = id
  }
  return out
}

// ── a stored row ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Where a normalised row keeps what it was (non-enumerable: never serialised, never spread, never saved). */
const ROW_ALIAS_KEYS = 'aliasKeys'
const ROW_LEGACY = 'legacyShape'

/**
 * A board row read in the new shape, in place (D41-7): `params` the one list, `aliases` null. What it was is kept beside it,
 * out of sight (`boardAliasKeys`, `boardWasLegacy`): the old alias keys of its cards' references, and whether a save must
 * rewrite those cards with it. Idempotent: a row already normalised is left as it is.
 */
export function normalizeBoardRow<B extends { params?: unknown; aliases?: unknown }>(board: B): B {
  if (Object.prototype.hasOwnProperty.call(board, ROW_LEGACY)) return board
  const n = normalizeBoardParams({ params: board.params, aliases: board.aliases })
  const legacy = n.changed || (board.aliases !== null && board.aliases !== undefined)
  if (legacy) {
    ;(board as { params?: unknown }).params = n.params.length > 0 ? n.params : null
    ;(board as { aliases?: unknown }).aliases = null
  }
  Object.defineProperty(board, ROW_ALIAS_KEYS, { value: n.aliasKeys, enumerable: false, configurable: true, writable: true })
  Object.defineProperty(board, ROW_LEGACY, { value: legacy, enumerable: false, configurable: true, writable: true })
  return board
}

/** The old alias keys of a normalised row (`normalizeBoardRow`); none for a row in the new shape or not normalised. */
export function boardAliasKeys(board: object): Record<string, string> {
  const v = (board as Record<string, unknown>)[ROW_ALIAS_KEYS]
  return isObj(v) ? (v as Record<string, string>) : {}
}

/** Was the row stored in an old shape (an alias list, an entity `remote-select`)? Its cards' references are then rewritten with it. */
export const boardWasLegacy = (board: object): boolean => (board as Record<string, unknown>)[ROW_LEGACY] === true

// ── references at run time ───────────────────────────────────────────────────────────────────────────────────────────

/** What a reference is read against: a board's parameters and its old alias keys (a query's or a command's board state). */
export interface ParamRefScope {
  params?: readonly BoardParam[]
  aliasKeys?: Readonly<Record<string, string>>
}

/** The board's entity parameter of `key`, if it has one. */
export function entityParamOf(state: ParamRefScope, key: string): EntityParamDef | undefined {
  const p = (state.params ?? []).find((d) => d.key === key)
  return p && isEntityParam(p) ? p : undefined
}

/**
 * A query or command param that names an entity parameter (phase 41): `{ $param, filter? }` on an entity parameter, or an old
 * `{ $alias, filter? }` (`legacy`), followed to the parameter it became. Its `memo` is what the resolver memoises it under.
 */
export interface EntityRef { key: string; filter?: string; memo: string; legacy: boolean }
export function entityRefOf(value: unknown, state: ParamRefScope): EntityRef | null {
  if (isAliasRef(value)) {
    const key = state.aliasKeys && Object.prototype.hasOwnProperty.call(state.aliasKeys, value.$alias) ? state.aliasKeys[value.$alias] : value.$alias
    return { key, ...(value.filter ? { filter: value.filter } : {}), memo: aliasRefKey({ $alias: key, filter: value.filter }), legacy: true }
  }
  if (isParamRef(value) && entityParamOf(state, value.$param)) {
    return { key: value.$param, ...(value.filter ? { filter: value.filter } : {}), memo: aliasRefKey({ $alias: value.$param, filter: value.filter }), legacy: false }
  }
  return null
}

/** An entity parameter a param may take as its plain value outside an entity slot: one entity the viewer or the page sets. */
export const isPlainEntityParam = (p: EntityParamDef | undefined): boolean =>
  !!p && !p.multiple && (p.choose.type === 'viewer' || (p.choose.type === 'page' && !p.choose.param))

/**
 * A viewer's pick narrowed to a set (`within`, phase 41.3): taken as a plain value only once the resolver found it in that set,
 * so a link or a forged request cannot hand a query or a command an entity outside it.
 */
export const isNarrowedPick = (p: EntityParamDef | undefined): boolean =>
  !!p && p.choose.type === 'viewer' && p.choose.within !== undefined

/**
 * The resolver keys of the narrowed picks a command's stored params take as plain values (`{ $param }`, bare or as a `$map`'s
 * `from`, as `commandEntityRefs` left them) and that have a value: the run route resolves them first, so one outside its set
 * is the 422 an alias's pick outside its set is.
 */
export function narrowedPickKeys(stored: Record<string, unknown>, state: ParamRefScope & { paramValues: Record<string, unknown> }): string[] {
  const out = new Set<string>()
  const check = (ref: unknown): void => {
    if (!isParamRef(ref) || ref.filter !== undefined) return
    if (!isNarrowedPick(entityParamOf(state, ref.$param)) || !Object.prototype.hasOwnProperty.call(state.paramValues, ref.$param)) return
    out.add(aliasRefKey({ $alias: ref.$param }))
  }
  for (const value of Object.values(stored)) {
    const map = isObj(value) ? (value as { $map?: { from?: unknown } }).$map : undefined
    check(map && isObj(map) && map.from !== undefined ? map.from : value)
  }
  return [...out]
}

/**
 * A command's stored params with their entity references in the form the run resolves (phase 41): a reference on a parameter
 * the command declares `entityTypes` for, or one that is not an entity the viewer or the page sets, becomes the resolver's
 * `{ $alias: <parameter>, filter? }` (resolved behind the entity type's permission, or refused where the command takes no
 * entity, as an alias always was); a plain one on a parameter without entity types stays `{ $param }`, the value it was
 * (D41-7). Bare or as a `$map`'s `from`.
 */
export function commandEntityRefs(
  stored: Record<string, unknown>,
  state: ParamRefScope,
  takesEntity: (key: string) => boolean,
): Record<string, unknown> {
  const internal = (key: string, ref: unknown): unknown => {
    const r = entityRefOf(ref, state)
    if (!r) return ref
    if (!r.legacy && !r.filter && !takesEntity(key) && isPlainEntityParam(entityParamOf(state, r.key))) return ref
    return { $alias: r.key, ...(r.filter ? { filter: r.filter } : {}) }
  }
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(stored)) {
    const map = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as { $map?: { from?: unknown } }).$map : undefined
    out[key] = map && typeof map === 'object' && map.from !== undefined
      ? { ...(value as object), $map: { ...map, from: internal(key, map.from) } }
      : internal(key, value)
  }
  return out
}
