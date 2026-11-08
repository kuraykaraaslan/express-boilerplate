import { migrate, readNamespace, readStamp, STAMP_KEY } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/engine'
import type { MigrationOp, MigrationStep, SettingsTemplate, Sparse, TemplateField } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/types'
import type { FieldType } from '@kuraykaraaslan-labs/common/server/schema-form.types'

/**
 * Phase 21.8: a tenant-authored widget's settings are a versioned template too (D-21.6), with
 * `tenant:<type>` as its id. The version moves only when the widget is PUBLISHED (the published
 * snapshot is what placements follow), and only when the schema changed in a way old settings
 * cannot simply be read with: a field renamed, dropped or retyped, an option removed, a number
 * range narrowed, or a default changed. Each bump appends one step of DECLARATIVE ops (no stored
 * code, D-21.2) to `dashboard_widgets.settingsMigrations`; steps are never edited or removed.
 *
 * 7c, deprecate before drop: a field removed from the draft (and not renamed) is first published
 * DEPRECATED (`schema[key].deprecated = { since: V, removeIn: V + 1 }` on the published snapshot only;
 * no op, so no bump on its own): cards keep its value read-only. The next publish drops it (a `drop`
 * op and a bump), unless the draft lists the field again without the marker, which restores it.
 *
 * Pure and import-light: the publish service, the placement write path, the board package and the
 * browser (render and the settings drawer) all migrate with this same code.
 */

export const TENANT_TEMPLATE_PREFIX = 'tenant:'
export const tenantTemplateId = (type: string) => `${TENANT_TEMPLATE_PREFIX}${type}` as const

/** One stored step: a `MigrationStep` without the code escape hatch. */
export type TenantMigrationStep = Omit<MigrationStep, 'up'>

/** The author's "this field used to be called…" answers, given at publish. */
export interface FieldRename { from: string; to: string }

/** The part of a widget definition the diff reads. */
export interface TenantDefinition {
  schema?: object | null
  defaultProps?: object | null
}

/** One schema change that needs a step, for the publish summary and the step's note. */
export interface SchemaChange {
  kind: 'rename' | 'drop' | 'retype' | 'options' | 'narrow' | 'default' | 'deprecate'
  key: string
  /** The new key of a rename. */
  to?: string
}

export interface DerivedOps {
  ops: MigrationOp[]
  defaultChanges: NonNullable<MigrationStep['defaultChanges']>
  changes: SchemaChange[]
  /** Renames that do not describe this diff (an unknown key, a key used twice, a retyped field). */
  invalidRenames: FieldRename[]
  /** 7c: removed fields this publish marks deprecated (no op); `publishedSchema` keeps them, marked. */
  deprecated: string[]
}

type Field = { type?: unknown; options?: unknown; min?: unknown; max?: unknown; value?: unknown; deprecated?: unknown }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const fieldsOf = (d: TenantDefinition | null | undefined): Record<string, Field> =>
  (isObj(d?.schema) ? d.schema : {}) as Record<string, Field>
const optionValues = (f: Field): string[] =>
  (Array.isArray(f.options) ? f.options : []).map((o) => (isObj(o) ? String(o.value) : String(o)))
/** What a placement that never set the key shows: the definition's default props win over the field's `value`. */
const defaultOf = (d: TenantDefinition | null | undefined, key: string): unknown => {
  const props = isObj(d?.defaultProps) ? d.defaultProps : {}
  return props[key] !== undefined ? props[key] : fieldsOf(d)[key]?.value
}
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const isDeprecated = (f: Field | undefined) => !!f && f.deprecated != null && f.deprecated !== false
/** A schema without the 7c markers: they are the server's, written only on a published snapshot. */
const stripMarkers = (schema: Record<string, Field>): Record<string, Field> =>
  Object.fromEntries(Object.entries(schema).map(([k, f]) => {
    if (!isObj(f) || !('deprecated' in f)) return [k, f]
    const { deprecated: _marker, ...rest } = f
    void _marker
    return [k, rest]
  }))

/**
 * The declarative ops that carry settings written for `prev` to `next` (the D-21.6 change rules):
 * - a rename the author named → `rename` (a removed key and an added key of the same type);
 * - a removed key → deprecated first (7c: no op, the published field is marked), `drop` at the next
 *   publish; a key whose type changed → `drop` at once (the value cannot be read as the new type);
 * - a select option removed → `mapValue` to the new default when it is an option, else to null (unset);
 * - a multi-select option removed → `filterList` takes it out of each card's list (runtime options that
 *   became a fixed list → `filterList` keeping only the listed ones);
 * - a number range narrowed → `clamp` to the new bounds;
 * - a changed default → recorded in `defaultChanges`; with `keepOldDefaults` (the default) a
 *   `materializeDefault` keeps the old value on cards that never set it ('preserve'), otherwise
 *   those cards follow the new default on purpose ('propagate').
 * Adding a field or an option, or changing a label or a widened range, needs no op.
 *
 * The draft's own `deprecated` markers are ignored (they are server-owned), with one exception: a
 * field the previous publish deprecated that the draft still lists WITH a marker (a widget transfer
 * carries the published schema, markers included) is dropped, like one the draft no longer lists.
 */
export function deriveSchemaOps(
  prev: TenantDefinition | null | undefined,
  next: TenantDefinition,
  opts: { renames?: FieldRename[]; keepOldDefaults?: boolean } = {},
): DerivedOps {
  const before = fieldsOf(prev)
  const draft = fieldsOf(next)
  const after = stripMarkers(draft)
  const keep = opts.keepOldDefaults !== false
  const out: DerivedOps = { ops: [], defaultChanges: [], changes: [], invalidRenames: [], deprecated: [] }

  // A rename is only believed when it describes this diff: `from` is gone, `to` is new, same type, each used once.
  const renamedTo = new Map<string, string>()
  const usedTo = new Set<string>()
  for (const r of opts.renames ?? []) {
    const ok = r.from in before && !(r.from in after) && r.to in after && !(r.to in before)
      && !renamedTo.has(r.from) && !usedTo.has(r.to) && before[r.from].type === after[r.to].type
    if (!ok) { out.invalidRenames.push(r); continue }
    renamedTo.set(r.from, r.to)
    usedTo.add(r.to)
    out.ops.push({ op: 'rename', from: r.from, to: r.to })
    out.changes.push({ kind: 'rename', key: r.from, to: r.to })
  }

  for (const [oldKey, was] of Object.entries(before)) {
    const key = renamedTo.get(oldKey) ?? oldKey
    const now = after[key]
    const renamed = renamedTo.has(oldKey)
    if (!now && !renamed && !isDeprecated(was)) {
      out.deprecated.push(oldKey)
      out.changes.push({ kind: 'deprecate', key: oldKey })
      continue
    }
    if (!now || (!renamed && isDeprecated(was) && isDeprecated(draft[key]))) {
      out.ops.push({ op: 'drop', key })
      out.changes.push({ kind: 'drop', key })
      continue
    }
    if (now.type !== was.type) {
      out.ops.push({ op: 'drop', key })
      out.changes.push({ kind: 'retype', key })
      continue
    }
    const oldDefault = defaultOf(prev, oldKey)
    const newDefault = defaultOf(next, key)
    if (oldDefault !== undefined && !same(oldDefault, newDefault)) {
      const policy = keep ? 'preserve' as const : 'propagate' as const
      out.defaultChanges.push({ key, from: oldDefault, to: newDefault ?? null, policy })
      if (keep) out.ops.push({ op: 'materializeDefault', key, value: oldDefault })
      out.changes.push({ kind: 'default', key })
    }
    if (now.type === 'select' || now.type === 'multi-select') {
      const allowed = optionValues(now)
      const fallback = typeof newDefault === 'string' && allowed.includes(newDefault) ? newDefault : null
      // An empty option list is loaded at runtime: nothing can be said about what was removed.
      const removed = allowed.length ? optionValues(was).filter((o) => !allowed.includes(o)) : []
      const becameFixed = allowed.length > 0 && optionValues(was).length === 0
      if (now.type === 'select' && becameFixed) {
        // Runtime options became a fixed list: any stored value outside it would fail every later save (422),
        // so values in the list stay and everything else maps to the default (or unset).
        out.ops.push({ op: 'mapValue', key, map: Object.fromEntries(allowed.map((o) => [o, o])), else: fallback })
        out.changes.push({ kind: 'options', key })
      } else if (removed.length && now.type === 'select') {
        out.ops.push({ op: 'mapValue', key, map: Object.fromEntries(removed.map((o) => [o, fallback])) })
        out.changes.push({ kind: 'options', key })
      } else if (now.type === 'multi-select' && becameFixed) {
        // The same for a list: choices in the new fixed list stay, the rest go (an emptied list falls back to the default).
        out.ops.push({ op: 'filterList', key, keep: allowed })
        out.changes.push({ kind: 'options', key })
      } else if (removed.length && now.type === 'multi-select') {
        // Validation refuses a choice outside the option list, so a removed option is taken out of each card's
        // list; the card's other choices survive.
        out.ops.push({ op: 'filterList', key, remove: removed })
        out.changes.push({ kind: 'options', key })
      }
    }
    if (now.type === 'number') {
      const [oldMin, oldMax, newMin, newMax] = [num(was.min), num(was.max), num(now.min), num(now.max)]
      const raisedMin = newMin !== undefined && (oldMin === undefined || newMin > oldMin)
      const loweredMax = newMax !== undefined && (oldMax === undefined || newMax < oldMax)
      if (raisedMin || loweredMax) {
        out.ops.push({ op: 'clamp', key, ...(newMin !== undefined ? { min: newMin } : {}), ...(newMax !== undefined ? { max: newMax } : {}) })
        out.changes.push({ kind: 'narrow', key })
      }
    }
  }
  return out
}

/** One line per step, for the editor and the changelog. */
export function describeChanges(changes: SchemaChange[]): string {
  const words: Record<SchemaChange['kind'], (c: SchemaChange) => string> = {
    rename: (c) => `renamed ${c.key} to ${c.to}`,
    drop: (c) => `removed ${c.key}`,
    retype: (c) => `changed the type of ${c.key}`,
    options: (c) => `removed options of ${c.key}`,
    narrow: (c) => `narrowed the range of ${c.key}`,
    default: (c) => `changed the default of ${c.key}`,
    deprecate: (c) => `deprecated ${c.key}`,
  }
  return changes.map((c) => words[c.kind](c)).join('; ').slice(0, 500)
}

/**
 * The schema a publish SNAPSHOTS (7c); the live row keeps the author's draft. A first publish takes the
 * draft as it is, markers included (a transferred widget arrives with its source's). Otherwise the draft
 * without markers, without the fields this publish drops, and with each field `derived` deprecates put back
 * as it was last published, marked `{ since: version, removeIn: version + 1 }`. Pure.
 */
export function publishedSchema(
  next: object | null | undefined,
  prev: object | null | undefined,
  derived: Pick<DerivedOps, 'deprecated' | 'changes'>,
  version: number,
  opts: { firstPublish: boolean },
): Record<string, unknown> {
  const draft = (isObj(next) ? next : {}) as Record<string, Field>
  if (opts.firstPublish) return { ...draft }
  const before = (isObj(prev) ? prev : {}) as Record<string, Field>
  const dropped = new Set(derived.changes.filter((c) => c.kind === 'drop').map((c) => c.key))
  const out: Record<string, unknown> = {}
  for (const [k, f] of Object.entries(stripMarkers(draft))) if (!dropped.has(k)) out[k] = f
  for (const k of derived.deprecated) {
    if (isObj(before[k])) out[k] = { ...before[k], deprecated: { since: version, removeIn: version + 1 } }
  }
  return out
}

/**
 * What a publish writes for the template: the same version when nothing needs a step, else the
 * next version with one step appended. The id follows the CURRENT type (a renamed type keeps its
 * version line; `storedTenantVersion` reads the old id's stamp).
 */
export function nextTenantTemplate(
  type: string,
  current: { settingsTemplate?: { id: string; version: number } | null; settingsMigrations?: TenantMigrationStep[] | null },
  derived: Pick<DerivedOps, 'ops' | 'defaultChanges' | 'changes'>,
): { settingsTemplate: { id: string; version: number }; settingsMigrations: TenantMigrationStep[]; bumped: boolean } {
  const steps = Array.isArray(current.settingsMigrations) ? current.settingsMigrations : []
  const version = tenantVersionOf(current.settingsTemplate)
  const id = tenantTemplateId(type)
  if (derived.ops.length === 0 && derived.defaultChanges.length === 0) {
    return { settingsTemplate: { id, version }, settingsMigrations: steps, bumped: false }
  }
  const step: TenantMigrationStep = {
    from: version,
    to: version + 1,
    note: describeChanges(derived.changes),
    ops: derived.ops,
    ...(derived.defaultChanges.length ? { defaultChanges: derived.defaultChanges } : {}),
  }
  return { settingsTemplate: { id, version: version + 1 }, settingsMigrations: [...steps, step], bumped: true }
}

/** A tenant template's version; a row published before 21.8 (no template yet) is the baseline v1. */
const tenantVersionOf = (t: { id: string; version: number } | null | undefined): number =>
  t && t.id.startsWith(TENANT_TEMPLATE_PREFIX) && Number.isInteger(t.version) && t.version >= 1 ? t.version : 1

/** The widget fields `tenantTemplate` reads (the PUBLISHED definition). */
export interface TenantTemplateSource {
  type: string
  schema?: object | null
  /** What a card that never set a key shows (the renderer merges only these, never a field's `value`). */
  defaultProps?: object | null
  settingsTemplate?: { id: string; version: number } | null
  settingsMigrations?: TenantMigrationStep[] | null
}

// NB's field vocabulary (`common/server/schema-form.types.ts`). The widget DTO takes any `type`, so a
// field outside it passes through as `json`, as the zod check let it through as `unknown` before 21.8.
const FIELD_TYPES = new Set<string>([
  'text', 'url', 'textarea', 'color', 'boolean', 'number', 'select', 'multi-select', 'json', 'img', 'repeater',
  'icon', 'rich-text', 'datetime', 'date', 'link', 'color-token', 'background', 'symbol', 'media', 'remote-select',
] satisfies FieldType[])
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v)

/**
 * One loosely typed schema field as the engine reads it: a string label, a known type, an option list
 * of strings or `{ value: string }` objects, numeric bounds, and repeater sub-fields normalised the same
 * way. Anything else is dropped, so a hand-written schema can never make validation throw.
 */
function engineField(key: string, raw: unknown): Record<string, unknown> {
  const f = isObj(raw) ? raw : {}
  const out: Record<string, unknown> = { ...f, label: typeof f.label === 'string' ? f.label : key, type: typeof f.type === 'string' && FIELD_TYPES.has(f.type) ? f.type : 'json' }
  if (Array.isArray(f.options)) out.options = f.options.filter((o) => typeof o === 'string' || (isObj(o) && typeof o.value === 'string'))
  else delete out.options
  if (isObj(f.fields)) out.fields = Object.fromEntries(Object.entries(f.fields).map(([k, sub]) => [k, engineField(k, sub)]))
  else delete out.fields
  for (const n of ['min', 'max', 'maxLength']) if (!finite(f[n])) delete out[n]
  return out
}

/**
 * The engine template of a tenant-authored widget: its published schema as the fields (normalised,
 * see `engineField`), its steps as the migrations. Migration reads it, and so does validation since
 * 7d (`tenantSettingsForSave`: the engine's `validate`, then `prune` against `defaultProps`).
 */
export function tenantTemplate(widget: TenantTemplateSource): SettingsTemplate {
  const fields: Record<string, TemplateField> = {}
  for (const [k, f] of Object.entries(isObj(widget.schema) ? widget.schema : {})) fields[k] = { ...engineField(k, f), since: 1 } as TemplateField
  return {
    id: tenantTemplateId(widget.type),
    version: tenantVersionOf(widget.settingsTemplate),
    namespace: '',
    label: widget.type,
    groups: [],
    fields,
    migrations: (Array.isArray(widget.settingsMigrations) ? widget.settingsMigrations : []) as MigrationStep[],
  }
}

/**
 * The version a stored settings object is at for this template. A placement belongs to exactly one
 * widget, so a `tenant:` stamp under another id is this widget's from before its type was renamed.
 */
export function storedTenantVersion(settings: Sparse | null | undefined, template: SettingsTemplate, unstamped = 1): number {
  const stamp = readStamp(settings) as Record<string, number>
  if (stamp[template.id] !== undefined) return stamp[template.id]
  const other = Object.entries(stamp).filter(([id]) => id.startsWith(TENANT_TEMPLATE_PREFIX)).map(([, v]) => v)
  return other.length ? Math.max(...other) : unstamped
}

export interface TenantMigrateResult {
  /** The whole settings object, own keys migrated, `$v` naming this template at its version. */
  settings: Sparse
  applied: Array<{ from: number; to: number; note: string }>
  /** Set when the stored object is newer than the template: `settings` is returned untouched. */
  newer?: { id: string; stored: number; known: number }
}

/**
 * Bring a placement's own (top-level) keys up to the template's version. `$`-namespaces (`$card`) are
 * left as they are; stale `tenant:` stamps are replaced by this template's. A `null` left on a select
 * by a `mapValue` (its option was removed and there is no default to map to) means "unset" and is
 * removed. Pure; the caller decides whether the stamp is stored (only the server stores it).
 *
 * `unstamped` is the version an object WITHOUT a `tenant:` stamp is taken to be at: 1 for stored data and
 * packages (everything written before 21.8 is the v1 baseline), but a write path passes what the request
 * really is (a new card is at the current version; an unstamped update continues from the stored row), so
 * no step meant for old data runs on values written in today's shape.
 */
export function migrateTenantSettings(template: SettingsTemplate, stored: Sparse | null | undefined, unstamped = 1): TenantMigrateResult {
  const settings = isObj(stored) ? stored : {}
  const from = storedTenantVersion(settings, template, unstamped)
  const res = migrate(template, readNamespace(settings, template), from)
  if (res.newer) return { settings, applied: [], newer: { id: template.id, ...res.newer } }
  const values = { ...res.values }
  for (const [k, v] of Object.entries(values)) {
    // A `$` key is a platform namespace (`$card`, `$format`), validated on its own path: a step may never write one.
    if (k.startsWith('$') || (v === null && template.fields[k]?.type === 'select')) delete values[k]
  }
  // Own keys first, then the namespaces, `$v` last: a second pass writes the same bytes (round trip).
  const out: Sparse = { ...values }
  for (const [k, v] of Object.entries(settings)) if (k.startsWith('$') && k !== STAMP_KEY) out[k] = v
  const stamp: Record<string, number> = {}
  for (const [id, v] of Object.entries(readStamp(settings))) if (!id.startsWith(TENANT_TEMPLATE_PREFIX)) stamp[id] = v as number
  stamp[template.id] = template.version
  out[STAMP_KEY] = stamp
  return { settings: out, applied: res.applied }
}

/** A catalog entry as the browser holds it (`WidgetDescriptor`), for `readTenantSettings`. */
export interface TenantDescriptorLike {
  ref: string
  key: string
  componentId?: string | null
  schema?: object | null
  settingsTemplate?: { id: string; version: number } | null
  settingsMigrations?: TenantMigrationStep[] | null
}

/**
 * A placement's settings as a tenant-authored widget reads them (the engine's read: migrated, never
 * written back). Builtins and presets (a platform-set `componentId`), `manifest:` and `ext:` widgets
 * are returned as stored. `newer`: written by a newer template version and returned untouched; the
 * settings drawer opens such settings read-only, since the server would refuse to save them.
 */
export function readTenantSettings(
  widget: TenantDescriptorLike,
  stored: Sparse | null | undefined,
): { settings: Sparse; newer?: TenantMigrateResult['newer'] } {
  const settings = isObj(stored) ? stored : {}
  if (!widget.ref.startsWith('db:') || widget.componentId) return { settings }
  const template = tenantTemplate({ type: widget.key, schema: widget.schema, settingsTemplate: widget.settingsTemplate, settingsMigrations: widget.settingsMigrations })
  const res = migrateTenantSettings(template, settings)
  return res.newer ? { settings, newer: res.newer } : { settings: res.settings }
}
