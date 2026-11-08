/**
 * Scene bindings (docs/phases/07-dashboard/42, D42-3, D42-4, D42-9): the grammar and the size caps of one row, as pure functions the
 * DTO, the service and the tests share.
 */
import { hasUnsafeKeys } from './card-overlay'
import { MAX_EXPRESSION_CHARS, MAX_INPUTS_PER_FIELD, expressionProblems, inputNameProblems } from './scene-expression'
import { designRuleIssues, staleReferences, type StaleReference } from '@kuraykaraaslan-labs/common/server/widget-settings/views/design-rules-logic'

/** A scene key, D42-4: the intersection of the 2D element-id rule, the telemetry `ELEMENT_ID` and kui-viewer 37a's key format. */
export const SCENE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.-]{0,47}$/
/** A device role: a key without the `.` that separates a role from an element (`fryer.heater`); `""` is the main role. */
export const SCENE_ROLE_RE = /^(?:[A-Za-z_][A-Za-z0-9_-]{0,47})?$/
/** A slot: which scene of the subject. */
export const SCENE_SLOT_RE = /^[a-z][a-z0-9_-]{0,31}$/
/** A scene kind's contribution key. */
export const SCENE_KIND_RE = /^[a-z][a-z0-9_]{0,31}$/
export const DEFAULT_SLOT = 'main'

/**
 * The slots the server allocates after `main` (phase 47, D106): `view_2`, `view_3` … (the existing grammar, lower case). A person never types or
 * reads one: a view is known by its kind and its drawing's name, the slot is only the row key.
 */
export const ALLOCATED_SLOT_PREFIX = 'view_'
/** The most views of one kind one subject holds (47.1): an allocation past it is refused (422), so a click loop never grows a subject's rows without end. */
export const MAX_SUBJECT_VIEWS = 50

/**
 * The next free slot of a subject and kind (47.1, D106): `main` while it is free, else the first of `view_2`, `view_3` … that is free. A slot already
 * taken (an allocated one, or one a person typed before phase 47) is skipped, so the answer never names a stored row. Pure.
 */
export function nextFreeSlot(taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(DEFAULT_SLOT)) return DEFAULT_SLOT
  for (let n = 2; ; n++) {
    const slot = `${ALLOCATED_SLOT_PREFIX}${n}`
    if (!used.has(slot)) return slot
  }
}

/** Where a slot stands in the allocation order (D106): 1 for `main`, n for `view_n` (n ≥ 2), null for a slot a person named by hand. Pure. */
export function slotOrdinal(slot: string): number | null {
  if (slot === DEFAULT_SLOT) return 1
  const m = /^view_([1-9][0-9]{0,4})$/.exec(slot)
  const n = m ? Number(m[1]) : NaN
  return n >= 2 ? n : null
}

/** The slot a card draws: its `sceneSlot` setting when that is a valid slot, else `main` (D42-1: a card names its slot). */
export function slotOf(settings: unknown): string {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).sceneSlot : undefined
  return typeof raw === 'string' && SCENE_SLOT_RE.test(raw) ? raw : DEFAULT_SLOT
}
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** At most this many role -> device entries on one binding. */
export const MAX_BINDING_DEVICES = 100
/** At most this many exceptions in `map`, and keys in `hidden`. */
export const MAX_BINDING_MAP = 500
/** At most this many rules, and no rule deeper than this. */
export const MAX_BINDING_RULES = 200
export const MAX_RULE_DEPTH = 6
/**
 * The whole row's JSON (devices, map, hidden, view, rules) in bytes. 32 KiB until phase 45 (SM2-5): a field map is written per symbol and per
 * field, with a label and a device id each (a 100-symbol board with four labelled fields is about 40 KiB), and the rules alone can take 30 KiB,
 * so the two together need more than 32 KiB; 96 KiB left room for both. Since slice 16 (SU-3) a field may carry up to four named inputs of
 * about 70 bytes each (a device id and a key): a 100-symbol board whose four fields all read expressions over four inputs is about 150 KiB,
 * which no real drawing is (an expression is the exotic case), so 128 KiB holds the realistic worst case and the rules. A board open carries
 * at most `MAX_SCENE_NEEDS` (24) bindings, 3 MiB at the very worst.
 */
export const MAX_BINDING_BYTES = 128 * 1024

// ─── The field map (phase 45, D45-3) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * A symbol field: the symbol's own vocabulary (`SCENE_COLUMNS` and `STATE_COLUMNS` of the widget kit, kui-viewer's standard live keys) and a 3D
 * item's own parameter (`doorOpen`): a lower-case letter, then letters, digits and `_`, at most 32 (SM2-2). The row columns a field may never take
 * (`RESERVED_FIELD_NAMES`) are refused beside the prototype names. A test pins that every word of the closed vocabularies passes.
 */
export const SYMBOL_FIELD_RE = /^[a-z][a-zA-Z0-9_]{0,31}$/
/** The columns a row is identified by: a field's value lands on the row under its name, so none of these may be a field. */
export const RESERVED_FIELD_NAMES: ReadonlySet<string> = new Set(['id', 'element', 'deviceId', 'ts', 'updatedAt'])
/**
 * A telemetry key as the telemetry store accepts one: `KEY_CHARS` and `MAX_KEY_LENGTH` of `telemetry/server/telemetry.rules.ts` (letters, digits,
 * `_ . -`, at most 64), mirrored here because the dashboard imports nothing of the telemetry modules (a test pins the two equal).
 */
export const TELEMETRY_KEY_RE = /^[A-Za-z0-9_.\-]{1,64}$/
/** At most this many fields on one map entry. */
export const MAX_FIELDS_PER_ENTRY = 16
/** The longest label a field carries. */
export const MAX_FIELD_LABEL = 60
export const isSymbolField = (s: string): boolean => SYMBOL_FIELD_RE.test(s) && !isUnsafeName(s) && !RESERVED_FIELD_NAMES.has(s)

/**
 * One named input of a field's expression (slice 16, SU-3): a telemetry key of a bound device (absent `deviceId`: the field's device, else the
 * entry's, else the key's role device, else the main device), read in the same batched read as the field's own key and handed to the expression
 * under the input's name.
 */
export interface SceneFieldInput {
  deviceId?: string
  key: string
}

/**
 * One field of a symbol read from one telemetry key: the key, the device it is read from (absent: the entry's, else the key's role device), a name to
 * show and, since phase 45.3 (D45-10), `script`: ONE expression over `value`, `row` and `now` that converts the key's raw value for the symbol
 * (`!value`, `value / 4095 * 100`; `scene-expression.ts` is its only judge, at most `MAX_FIELD_SCRIPT` characters). Additive: no stored row has it.
 * Since slice 16 (SU-3) a field may also carry `inputs`, at most `MAX_INPUTS_PER_FIELD` named keys the expression reads by name (`supply - return_in`),
 * and `key` may then be absent: a field reads a value (`key`, the primary input `value`), or an expression over its inputs (`script` with at least one
 * input and no key), or both (`value` is the key's value, the inputs are beside it). Every stored row before slice 16 has a `key` and no `inputs`.
 */
export interface SceneFieldRead {
  deviceId?: string
  key?: string
  label?: string
  script?: string
  inputs?: Record<string, SceneFieldInput>
}
/** The longest convert expression of a field. */
export const MAX_FIELD_SCRIPT = MAX_EXPRESSION_CHARS
export { MAX_INPUTS_PER_FIELD }

/** Whether a field read says where it reads from: a key, or an expression over at least one input. */
export const fieldHasSource = (r: Pick<SceneFieldRead, 'key' | 'script' | 'inputs'>): boolean =>
  r.key !== undefined || (r.script !== undefined && !!r.inputs && Object.keys(r.inputs).length > 0)

/**
 * One entry of a binding's `map` (v2, phase 45, D45-3): the element shortcut (`deviceId` + `element`: the whole row of that element of that device,
 * the only shape before phase 45, still valid as stored), the field map (`fields`: each symbol field read from a telemetry key of a bound device),
 * or both. `deviceId` on an entry with `fields` is the default device of its fields. At least one of `element` and `fields`.
 */
export interface SceneMapEntry {
  deviceId?: string
  element?: string
  fields?: Record<string, SceneFieldRead>
}

/** The entity types whose device ids a binding names are checked against the tenant's devices. */
export const DEVICE_ENTITY_TYPE = 'iot_device'
/** The entity type of the containing nodes of the topology. */
export const ASSET_ENTITY_TYPE = 'iot_asset'

/** Names a binding never carries as a role, a key or a scene key: they would reach the prototype chain of an object built from them. */
export const UNSAFE_NAMES: ReadonlySet<string> = new Set(['constructor', 'prototype', '__proto__'])
export const isUnsafeName = (name: string): boolean => UNSAFE_NAMES.has(name)

export interface SceneBindingBody {
  devices: Record<string, string>
  map: Record<string, SceneMapEntry>
  hidden: string[] | null
  view: { level?: string; focus?: string } | null
  rules: Array<Record<string, unknown>> | null
}

/** The JSON size of a binding's free-form columns, in bytes (what the 32 KiB cap counts). */
export function bindingBytes(b: Partial<SceneBindingBody>): number {
  return Buffer.byteLength(JSON.stringify({ devices: b.devices ?? {}, map: b.map ?? {}, hidden: b.hidden ?? null, view: b.view ?? null, rules: b.rules ?? null }), 'utf8')
}

/** How deep a JSON value nests (a scalar is 0). */
function depth(v: unknown): number {
  if (typeof v !== 'object' || v === null) return 0
  let d = 0
  for (const c of Array.isArray(v) ? v : Object.values(v)) d = Math.max(d, depth(c))
  return d + 1
}

/** Every device id a binding names (the `devices` roles, the `map` entries and their fields), lower-cased and without duplicates. */
export function deviceIdsOf(b: Pick<SceneBindingBody, 'devices' | 'map'>): string[] {
  const ids = new Set<string>()
  for (const id of Object.values(b.devices)) ids.add(id.toLowerCase())
  for (const e of Object.values(b.map)) {
    if (e.deviceId) ids.add(e.deviceId.toLowerCase())
    for (const f of Object.values(e.fields ?? {})) {
      if (f.deviceId) ids.add(f.deviceId.toLowerCase())
      for (const i of Object.values(f.inputs ?? {})) if (i.deviceId) ids.add(i.deviceId.toLowerCase())
    }
  }
  return [...ids]
}

/**
 * The problems in the raw, parsed JSON of a save request, found BEFORE the schema reads it: `JSON.parse` makes an own `__proto__`
 * key, which a schema silently drops from a record, so a body that carried one would pass as if it had not. Looks at the keys of the
 * body, of `devices`, of `map`, of every map entry's `fields` (phase 45) and of `view`.
 */
export function rawBodyProblems(raw: unknown): string[] {
  const out: string[] = []
  const keysOf = (where: string, v: unknown) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) return
    for (const k of Object.keys(v)) if (isUnsafeName(k)) out.push(`${where}: a name may not be __proto__, constructor or prototype`)
  }
  keysOf('body', raw)
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>
    for (const field of ['devices', 'map', 'view']) keysOf(field, r[field])
    if (typeof r.map === 'object' && r.map !== null && !Array.isArray(r.map)) {
      for (const e of Object.values(r.map as Record<string, unknown>)) {
        if (typeof e !== 'object' || e === null || Array.isArray(e)) continue
        const fields = (e as { fields?: unknown }).fields
        keysOf('map.fields', fields)
        if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) continue
        for (const f of Object.values(fields as Record<string, unknown>)) {
          if (typeof f === 'object' && f !== null && !Array.isArray(f)) keysOf('map.fields.inputs', (f as { inputs?: unknown }).inputs)
        }
      }
    }
  }
  return [...new Set(out)]
}

/** Roles, map keys, map elements, field names, hidden keys and view fields that are a prototype name (refused, never dropped). */
function unsafeNameProblems(b: SceneBindingBody): string[] {
  const out: string[] = []
  const say = (where: string) => out.push(`${where}: a name may not be __proto__, constructor or prototype`)
  if (Object.keys(b.devices).some(isUnsafeName)) say('devices')
  if (Object.entries(b.map).some(([k, e]) => isUnsafeName(k) || (e.element !== undefined && isUnsafeName(e.element)))) say('map')
  if (Object.values(b.map).some((e) => Object.entries(e.fields ?? {}).some(([f, r]) => isUnsafeName(f) || (r.key !== undefined && isUnsafeName(r.key))))) say('map.fields')
  if (Object.values(b.map).some((e) => Object.values(e.fields ?? {}).some((r) => Object.entries(r.inputs ?? {}).some(([n, i]) => isUnsafeName(n) || isUnsafeName(i.key))))) say('map.fields.inputs')
  if ((b.hidden ?? []).some(isUnsafeName)) say('hidden')
  if (b.view && [b.view.level, b.view.focus].some((v) => v !== undefined && isUnsafeName(v))) say('view')
  return out
}

/**
 * The devices a map's FIELDS read that are not devices of the binding (phase 45, SM2-4): a field is read live from the bound devices only (the card reads
 * the latest keys of the binding's `devices`, never of a device the binding does not name), so a field, or a fields entry, whose device is not one of the
 * role table's values would never get data. Each problem names the key (and the field) it is about. An element exception may still name any readable
 * device (unchanged: the drawer's pick from another device).
 */
export function fieldDeviceProblems(b: Pick<SceneBindingBody, 'devices' | 'map'>): string[] {
  const bound = new Set(Object.values(b.devices).map((id) => id.toLowerCase()))
  const out: string[] = []
  for (const [key, e] of Object.entries(b.map)) {
    if (!e.fields || Object.keys(e.fields).length === 0) continue
    if (e.deviceId !== undefined && !bound.has(e.deviceId.toLowerCase())) out.push(`map.${key}: device ${e.deviceId} is not one of the binding's devices`)
    for (const [f, r] of Object.entries(e.fields)) {
      if (r.deviceId !== undefined && !bound.has(r.deviceId.toLowerCase())) out.push(`map.${key}.fields.${f}: device ${r.deviceId} is not one of the binding's devices`)
      for (const [n, i] of Object.entries(r.inputs ?? {})) {
        if (i.deviceId !== undefined && !bound.has(i.deviceId.toLowerCase())) out.push(`map.${key}.fields.${f}.inputs.${n}: device ${i.deviceId} is not one of the binding's devices`)
      }
    }
  }
  return out
}

/** The shape of every map entry's fields, judged here beside the caps (the DTO judges the grammar of each name and key): the caps of phase 45. */
function fieldProblems(b: Pick<SceneBindingBody, 'map'>): string[] {
  const out: string[] = []
  for (const [key, e] of Object.entries(b.map)) {
    const withFields = !!e.fields && Object.keys(e.fields).length > 0
    if (e.element === undefined && !withFields) out.push(`map.${key}: an entry names an element, fields, or both`)
    if (e.element !== undefined && !e.deviceId) out.push(`map.${key}: an element names its device`)
    if (e.fields && Object.keys(e.fields).length > MAX_FIELDS_PER_ENTRY) out.push(`map.${key}: at most ${MAX_FIELDS_PER_ENTRY} fields`)
    // the convert expression of a field (45.3): judged once, by the function the runner and the panel judge with; its named inputs (slice 16) beside it
    for (const [f, r] of Object.entries(e.fields ?? {})) {
      const names = Object.keys(r.inputs ?? {})
      if (names.length > MAX_INPUTS_PER_FIELD) out.push(`map.${key}.fields.${f}.inputs: at most ${MAX_INPUTS_PER_FIELD} inputs`)
      for (const n of names) for (const p of inputNameProblems(n)) out.push(`map.${key}.fields.${f}.inputs: ${p}`)
      if (!fieldHasSource(r)) out.push(`map.${key}.fields.${f}: a field reads a value, or an expression over at least one input`)
      if (r.script === undefined) continue
      for (const p of expressionProblems(r.script, names.slice(0, MAX_INPUTS_PER_FIELD))) out.push(`map.${key}.fields.${f}.script: ${p}`)
    }
  }
  return out
}

/**
 * What each kind's rules must look like (phase 42.6, D42-11; phase 42.5.4 for `diagram`). Both kinds' rules are flat rows of one dialect each
 * (`design-rules-logic`: the 3D design card's effects, and the stored 2D diagram's, which are scene rules of the process scene's own engine), judged by
 * the one function the Scene drawer judges with as well. A kind with no entry is held to the generic caps below. The targets are not judged here (only
 * the document knows its keys): `staleRuleTargets`.
 *
 * A static map, not a contribution of the kind (docs/audits/2026-10-27-scene-bindings.md, SR-7 and SP-3): the check runs in a DTO that parses before any
 * tenant or kind is known, and loading the kind's provider there would make a pure schema async.
 */
const ruleProblemsOf = (dialect: 'design' | 'diagram') => (rules: unknown[]): string[] => designRuleIssues(rules, dialect).map((i) => {
  const at = /^rules\.(\d+)(?:\.(\w+))?$/.exec(i.path)
  return `rules: rule ${at ? Number(at[1]) + 1 : '?'}${at?.[2] ? ` ${at[2]}` : ''}: ${i.message}`
})
const RULE_PROBLEMS: Readonly<Record<string, (rules: unknown[]) => string[]>> = {
  design: ruleProblemsOf('design'),
  diagram: ruleProblemsOf('diagram'),
}

/** Whether a kind's rules have a shape of their own that `bindingProblems` judges (and whose targets are scene keys). */
export const kindHasRuleShape = (kind: string | undefined): boolean => kind !== undefined && Object.hasOwn(RULE_PROBLEMS, kind)

/**
 * The names the rules use that the document has no scene key for (a target or a row a condition reads): reported, never dropped, so a rule on a key
 * that left the design is kept and its author told (the card ignores such a rule). `keys` are the document's scene keys of equipment (levels and rooms
 * are no equipment); empty when the kind has no rule shape or the document has no keys.
 */
export function staleRuleTargets(kind: string, rules: unknown[] | null | undefined, keys: Iterable<string>): StaleReference[] {
  if (!kindHasRuleShape(kind) || !rules || rules.length === 0) return []
  return staleReferences(rules, keys)
}

/**
 * The problems of a binding body, empty when it is fine: the caps (100 devices, 500 map entries and hidden keys, 200 rules, 32 KiB
 * in all), the names no role or key may take, and the shape of `rules` (for a kind that has one, `kind`). Grammar of keys, roles and ids is the DTO's.
 */
export function bindingProblems(b: SceneBindingBody, kind?: string): string[] {
  const out: string[] = [...unsafeNameProblems(b), ...fieldProblems(b)]
  if (Object.keys(b.devices).length > MAX_BINDING_DEVICES) out.push(`devices: at most ${MAX_BINDING_DEVICES} entries`)
  if (Object.keys(b.map).length > MAX_BINDING_MAP) out.push(`map: at most ${MAX_BINDING_MAP} entries`)
  if ((b.hidden?.length ?? 0) > MAX_BINDING_MAP) out.push(`hidden: at most ${MAX_BINDING_MAP} keys`)
  if (b.rules) {
    if (b.rules.length > MAX_BINDING_RULES) out.push(`rules: at most ${MAX_BINDING_RULES} rules`)
    if (hasUnsafeKeys(b.rules)) out.push('rules: a key may not be __proto__, constructor or prototype')
    if (depth(b.rules) > MAX_RULE_DEPTH) out.push(`rules: nested deeper than ${MAX_RULE_DEPTH}`)
    if (kind !== undefined && Object.hasOwn(RULE_PROBLEMS, kind)) out.push(...RULE_PROBLEMS[kind]!(b.rules))
  }
  if (bindingBytes(b) > MAX_BINDING_BYTES) out.push(`binding: at most ${MAX_BINDING_BYTES} bytes of devices, map, hidden, view and rules`)
  return out
}

/**
 * `map` for a device bound in bulk to a design WITHOUT keys (the bulk action's `twin-index`): an item that the document labels with a name
 * other than its key is taken to be labelled with the element it was built from (the 2D to 3D import writes the diagram element's id as
 * the label of an item with no text), so the item's key (its id) maps to that element of the device. Items whose label is not a valid key,
 * and the document's levels and rooms (which are not equipment), are left out, and so is every item of a keyed design (its key already is the element, nothing to add); at most `MAX_BINDING_MAP` entries.
 */
export function twinIndexMap(keys: ReadonlyArray<{ key: string; label: string; kind: string; keyed?: boolean }>, deviceId: string): SceneBindingBody['map'] {
  const out: SceneBindingBody['map'] = {}
  for (const k of keys) {
    if (k.kind === 'level' || k.kind === 'room' || k.keyed) continue
    if (k.label === k.key || !SCENE_KEY_RE.test(k.label) || isUnsafeName(k.label) || isUnsafeName(k.key)) continue
    if (Object.keys(out).length >= MAX_BINDING_MAP) break
    out[k.key] = { deviceId, element: k.label }
  }
  return out
}

/** What "Use the same connections" took over (`takenOverConnections`). */
export interface TakenOverConnections {
  /** The entries for the target's map. */
  map: SceneBindingBody['map']
  /** The other devices the kept links read, by role, for the target's devices (never its main role; empty when nothing reads another device). */
  devices: Record<string, string>
  /** Symbols (map entries) taken over. */
  entries: number
  /** Fields that read the source device and now read the target. */
  repointed: number
  /** Fields that read another device (a tank both read, a companion meter) and still read it. */
  kept: number
  /** Fields that read another device there and now read its counterpart placed with the target (`counterparts`, test 3 #114: silo 1's fan → silo N's fan). */
  moved: number
  /** Fields left behind: they read a device the source binding does not bind (a stale entry), so it cannot be bound here either. */
  dropped: number
  /**
   * What reads another device than the source, by symbol (scene key) and that device, each pair once in map order (a field or an input of an expression):
   * what the question names before anything is taken (D591). `to` is the counterpart it reads instead when one was given.
   */
  otherReads: Array<{ key: string; deviceId: string; to?: string }>
}

/**
 * "Use the same connections" (e2e run 1, E6): a device's connections taken over from a device of the same profile that uses the same
 * drawing. A field that reads the source device reads the target instead (its device id taken off: the target's main role). A field or an
 * input that reads ANOTHER device (a tank both pumps read, a companion meter) is kept as it is, on that device; the device is bound to the
 * target under the role the source gives it (a role the target holds for another device takes a free name). Before, those were dropped
 * without a word and the question counted them. What reads a device the source does not bind is left behind and counted (`dropped`).
 * The element shortcuts stay behind, as in `copiedMapFor` (the bulk "apply to every device" of D45-5, which still reads each target's own
 * devices only). At most `MAX_BINDING_MAP` entries and `MAX_BINDING_DEVICES` devices.
 *
 * `counterparts` (D591, test 3 #114): another device a link read there → the device that stands for it beside the target (silo 1's fan → silo N's fan,
 * the one device of its profile placed with the target, found by the caller). Such a link reads the counterpart instead, bound under the role the source
 * gave the other device, and is counted `moved`; a device with no counterpart is kept as above. `otherReads` names what read another device either way.
 */
export function takenOverConnections(
  source: { deviceId: string; map: Readonly<Record<string, SceneMapEntry>>; devices?: Readonly<Record<string, string>> },
  target: { deviceId: string; devices?: Readonly<Record<string, string>> },
  options: { counterparts?: Readonly<Record<string, string>> } = {},
): TakenOverConnections {
  const from = source.deviceId.toLowerCase()
  const to = target.deviceId.toLowerCase()
  const roleOf = new Map<string, string>()
  for (const [role, id] of Object.entries(source.devices ?? {})) {
    const lower = id.toLowerCase()
    if (role !== '' && lower !== from && !roleOf.has(lower) && SCENE_ROLE_RE.test(role)) roleOf.set(lower, role)
  }
  // a counterpart is never the source itself (that would read the other device's twin on the source's side): such an entry is ignored
  const counterpart = new Map<string, string>()
  for (const [other, instead] of Object.entries(options.counterparts ?? {})) {
    const o = other.toLowerCase()
    const i = instead.toLowerCase()
    if (o !== from && o !== to && i !== from && !isUnsafeName(o)) counterpart.set(o, i)
  }
  const targetDevices = Object.fromEntries(Object.entries(target.devices ?? {}).map(([r, id]) => [r, id.toLowerCase()]))
  const added: Record<string, string> = {}
  // `id` is bound to the target under the role the source gives `roleFrom` (the other device a counterpart stands for)
  const bound = (id: string, roleFrom: string = id): boolean => {
    const lower = id.toLowerCase()
    if (lower === to || Object.values(targetDevices).includes(lower) || Object.values(added).includes(lower)) return true
    const role = roleOf.get(roleFrom.toLowerCase())
    if (!role || Object.keys(targetDevices).length + Object.keys(added).length >= MAX_BINDING_DEVICES) return false
    let name = role
    for (let n = 2; Object.hasOwn(targetDevices, name) || Object.hasOwn(added, name); n++) name = `${role.slice(0, 44)}${n}`
    added[name] = lower
    return true
  }
  // the device another device's link reads here: its counterpart when it has one (bound under the other's role), else itself
  const instead = (other: string): string => counterpart.get(other) ?? other
  const bindOther = (other: string): boolean => bound(instead(other), other)
  const out: TakenOverConnections = { map: {}, devices: added, entries: 0, repointed: 0, kept: 0, moved: 0, dropped: 0, otherReads: [] }
  const named = new Set<string>()
  const nameOther = (key: string, other: string) => {
    const at = `${key}\n${other}`
    if (named.has(at)) return
    named.add(at)
    const swap = counterpart.get(other)
    out.otherReads.push({ key, deviceId: other, ...(swap !== undefined ? { to: swap } : {}) })
  }
  for (const [key, e] of Object.entries(source.map)) {
    if (!SCENE_KEY_RE.test(key) || isUnsafeName(key) || !e.fields) continue
    // the device an entry's fields read when they name none: the entry's, else the main role (the source)
    const entryOther = e.deviceId !== undefined && e.deviceId.toLowerCase() !== from ? e.deviceId.toLowerCase() : undefined
    if (entryOther !== undefined && !bindOther(entryOther)) { out.dropped += Object.keys(e.fields).filter(isSymbolField).length; continue }
    const fields: Record<string, SceneFieldRead> = {}
    let repointed = 0
    let kept = 0
    let moved = 0
    const seen: string[] = []
    for (const [f, r] of Object.entries(e.fields)) {
      if (!isSymbolField(f)) continue
      const reads = r.deviceId !== undefined ? r.deviceId.toLowerCase() : entryOther
      const other = reads !== undefined && reads !== from ? reads : undefined
      if (other !== undefined && !bindOther(other)) { out.dropped += 1; continue }
      const inputs: Record<string, SceneFieldInput> = {}
      const inputOthers: string[] = []
      let lost = false
      for (const [n, i] of Object.entries(r.inputs ?? {})) {
        const at = i.deviceId?.toLowerCase()
        // no device: the field's own, whichever it is now; the source: the target, said outright when the field reads another device
        if (at === undefined) { inputs[n] = { key: i.key }; continue }
        if (at === from) { inputs[n] = other === undefined ? { key: i.key } : { deviceId: to, key: i.key }; continue }
        if (!bindOther(at)) { lost = true; break }
        inputs[n] = { deviceId: instead(at), key: i.key }
        inputOthers.push(at)
      }
      if (lost) { out.dropped += 1; continue }
      // a field that reads the source under an entry that reads another device names the target outright (taken off, it would read the entry's)
      const device = other !== undefined ? (r.deviceId !== undefined ? instead(other) : undefined) : (entryOther !== undefined ? to : undefined)
      const read: SceneFieldRead = {
        ...(device !== undefined ? { deviceId: device } : {}),
        ...(r.key !== undefined ? { key: r.key } : {}), ...(r.label !== undefined ? { label: r.label } : {}), ...(r.script !== undefined ? { script: r.script } : {}),
        ...(Object.keys(inputs).length ? { inputs } : {}),
      }
      if (!fieldHasSource(read)) continue
      fields[f] = read
      if (other !== undefined && counterpart.has(other)) moved += 1
      else if (other !== undefined) kept += 1
      else repointed += 1
      for (const o of other !== undefined ? [other, ...inputOthers] : inputOthers) seen.push(o)
    }
    if (Object.keys(fields).length === 0) continue
    if (Object.keys(out.map).length >= MAX_BINDING_MAP) break
    out.map[key] = { ...(entryOther !== undefined ? { deviceId: instead(entryOther) } : {}), fields }
    out.entries += 1
    out.repointed += repointed
    out.kept += kept
    out.moved += moved
    for (const o of seen) nameOther(key, o)
  }
  return out
}

/**
 * The map a device of a profile gets when a binding's connections are applied to it (phase 45 slice 16, SU-11; D45-5 "apply this mapping to every
 * device of the profile"): the FIELD entries of the source binding (`copyMap`, the element shortcuts and every device-specific part are left behind),
 * with every device id that is the source device (`sourceDeviceId`) taken off, so the field reads the target device's own main role; a field or an input
 * that reads ANOTHER device is dropped (that device is not the target's), and an entry left with no field is dropped too. The result holds no device id
 * at all, so `fieldDeviceProblems` is satisfied on a binding whose only device is the target. At most `MAX_BINDING_MAP` entries.
 */
export function copiedMapFor(copyMap: Readonly<Record<string, SceneMapEntry>>, sourceDeviceId: string | undefined, _targetDeviceId: string): SceneBindingBody['map'] {
  const source = sourceDeviceId?.toLowerCase()
  const own = (id: string | undefined): boolean => id === undefined || (source !== undefined && id.toLowerCase() === source)
  const out: SceneBindingBody['map'] = {}
  for (const [key, e] of Object.entries(copyMap)) {
    if (!SCENE_KEY_RE.test(key) || isUnsafeName(key) || !e.fields || !own(e.deviceId)) continue
    const fields: Record<string, SceneFieldRead> = {}
    for (const [f, r] of Object.entries(e.fields)) {
      if (!isSymbolField(f) || !own(r.deviceId)) continue
      const inputs: Record<string, SceneFieldInput> = {}
      let foreign = false
      for (const [n, i] of Object.entries(r.inputs ?? {})) {
        if (!own(i.deviceId)) { foreign = true; break }
        inputs[n] = { key: i.key }
      }
      if (foreign) continue
      const read: SceneFieldRead = { ...(r.key !== undefined ? { key: r.key } : {}), ...(r.label !== undefined ? { label: r.label } : {}), ...(r.script !== undefined ? { script: r.script } : {}), ...(Object.keys(inputs).length ? { inputs } : {}) }
      if (!fieldHasSource(read)) continue
      fields[f] = read
    }
    if (Object.keys(fields).length === 0) continue
    if (Object.keys(out).length >= MAX_BINDING_MAP) break
    out[key] = { fields }
  }
  return out
}
