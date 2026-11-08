import {
  MAX_BINDING_BYTES, MAX_BINDING_DEVICES, MAX_BINDING_MAP, MAX_FIELD_LABEL, MAX_FIELDS_PER_ENTRY, MAX_INPUTS_PER_FIELD, SCENE_KEY_RE, SCENE_ROLE_RE, TELEMETRY_KEY_RE, UUID_RE,
  fieldHasSource, isSymbolField, isUnsafeName, type SceneFieldInput, type SceneFieldRead, type SceneMapEntry,
} from './scene-binding'
import { expressionProblems, inputNameProblems } from './scene-expression'

/**
 * One symbol's entry of a scene binding, written by the side panel on the drawing (dashboard phase 45.4, D45-10; decisions SH2-8..SH2-12 of
 * docs/audits/2026-10-27-scene-bindings.md). Pure and shared: the panel's host merges ONE symbol's entry into the stored binding without ever dropping what
 * the person did not touch (the other symbols' entries, an element exception of this symbol, the hidden keys, the view, the rules), within the caps the server
 * judges with (`bindingProblems`): a result that would be refused is refused here first, naming why, never trimmed silently.
 *
 * The panel never shows a role. A device an entry reads that the binding does not hold yet is added to `devices` under a role the person never sees
 * (`freshRole`: `d1`, `d2`, … the first free one); the main role `""` is never touched, and no device is ever removed (an unused role is harmless: no row
 * is keyed by it, and the Scene drawer lists it for whoever wants it gone).
 */

/**
 * What the panel hands over for ONE symbol: all the fields it reads, each from a telemetry key of a device (`key`), or an expression (`script`) over
 * named `inputs` (slice 16, at most `MAX_INPUTS_PER_FIELD`), or both; with an optional label.
 */
export interface SymbolEntryInput {
  fields: Record<string, { deviceId?: string; key?: string; label?: string; script?: string; inputs?: Record<string, { deviceId?: string; key: string }> }>
}

/** The parts of a binding the merge reads and keeps: the whole of it counts toward the byte cap. */
export interface BindingParts {
  devices: Readonly<Record<string, string>>
  map: Readonly<Record<string, SceneMapEntry>>
  hidden?: readonly string[] | null
  view?: unknown
  rules?: unknown
}

export type EntryProblem =
  | 'invalid-key' | 'invalid-field' | 'invalid-device' | 'invalid-script' | 'too-many-fields' | 'map-full' | 'too-many-devices' | 'too-large' | 'nothing-to-save'

export type MergeResult =
  | { ok: true; devices: Record<string, string>; map: Record<string, SceneMapEntry>; addedRoles: Record<string, string> }
  | { ok: false; problem: EntryProblem; detail: string }

const lower = (s: string): string => s.toLowerCase()
const fail = (problem: EntryProblem, detail: string): MergeResult => ({ ok: false, problem, detail })

/** The JSON size of a binding's free-form columns in UTF-8 bytes (what `MAX_BINDING_BYTES` counts; `bindingBytes` of `scene-binding.ts` without Node's Buffer, so the browser can ask). */
export function bindingByteSize(b: BindingParts): number {
  return new TextEncoder().encode(JSON.stringify({ devices: b.devices, map: b.map, hidden: b.hidden ?? null, view: b.view ?? null, rules: b.rules ?? null })).length
}

/** The role of a device in the table (case-insensitive), the main role first. */
export function roleOfDevice(devices: Readonly<Record<string, string>>, deviceId: string): string | undefined {
  const id = lower(deviceId)
  const roles = Object.keys(devices).sort()
  return roles.find((r) => lower(devices[r]) === id)
}

/** The first role `d<n>` (n from 1) the table does not use: the name a panel-added device gets. It is never shown, so it only has to be valid and free. */
export function freshRole(devices: Readonly<Record<string, string>>): string {
  for (let n = 1; ; n++) {
    const role = `d${n}`
    if (!Object.hasOwn(devices, role) && SCENE_ROLE_RE.test(role)) return role
  }
}

const isKey = (k: unknown): k is string => typeof k === 'string' && TELEMETRY_KEY_RE.test(k) && !isUnsafeName(k)

/** One field as it is stored: device lower-cased, label and script trimmed and dropped when empty, the inputs (slice 16) judged by name. A problem names the field. */
function fieldOf(name: string, raw: SymbolEntryInput['fields'][string]): SceneFieldRead | { problem: EntryProblem; detail: string } {
  if (!isSymbolField(name)) return { problem: 'invalid-field', detail: `"${name}" is not a field a symbol can read` }
  if (!raw || typeof raw !== 'object') return { problem: 'invalid-field', detail: `${name}: the field is not valid` }
  if (raw.key !== undefined && !isKey(raw.key)) return { problem: 'invalid-field', detail: `${name}: the telemetry key is not valid` }
  if (raw.deviceId !== undefined && (typeof raw.deviceId !== 'string' || !UUID_RE.test(raw.deviceId))) return { problem: 'invalid-device', detail: `${name}: the device is not valid` }
  const label = typeof raw.label === 'string' ? raw.label.trim() : ''
  if (label.length > MAX_FIELD_LABEL) return { problem: 'invalid-field', detail: `${name}: the name is longer than ${MAX_FIELD_LABEL} characters` }
  const script = typeof raw.script === 'string' ? raw.script.trim() : ''
  if (raw.script !== undefined && typeof raw.script !== 'string') return { problem: 'invalid-script', detail: `${name}: the formula is not text` }
  const inputs: Record<string, SceneFieldInput> = {}
  if (raw.inputs !== undefined) {
    if (typeof raw.inputs !== 'object' || raw.inputs === null || Array.isArray(raw.inputs)) return { problem: 'invalid-script', detail: `${name}: the inputs are not valid` }
    const names = Object.keys(raw.inputs)
    if (names.length > MAX_INPUTS_PER_FIELD) return { problem: 'invalid-script', detail: `${name}: a formula reads at most ${MAX_INPUTS_PER_FIELD} inputs` }
    for (const n of names) {
      const p = inputNameProblems(n)
      if (p.length) return { problem: 'invalid-script', detail: `${name}: ${p[0]}` }
      const i = raw.inputs[n]
      if (!i || typeof i !== 'object' || !isKey(i.key)) return { problem: 'invalid-script', detail: `${name}: the input ${n} has no valid telemetry key` }
      if (i.deviceId !== undefined && (typeof i.deviceId !== 'string' || !UUID_RE.test(i.deviceId))) return { problem: 'invalid-device', detail: `${name}: the device of the input ${n} is not valid` }
      inputs[n] = { key: i.key, ...(i.deviceId !== undefined ? { deviceId: lower(i.deviceId) } : {}) }
    }
  }
  const withInputs = Object.keys(inputs).length > 0
  if (script) {
    const problems = expressionProblems(script, Object.keys(inputs))
    if (problems.length) return { problem: 'invalid-script', detail: `${name}: ${problems[0]}` }
  }
  const out: SceneFieldRead = {
    ...(raw.key !== undefined ? { key: raw.key } : {}), ...(raw.deviceId !== undefined ? { deviceId: lower(raw.deviceId) } : {}), ...(label ? { label } : {}),
    ...(script ? { script } : {}), ...(withInputs ? { inputs } : {}),
  }
  if (!fieldHasSource(out)) return { problem: 'invalid-field', detail: `${name}: pick a value, or write a formula over at least one input` }
  return out
}

/**
 * Merges one symbol's entry into a binding's devices and map. The symbol's `fields` are REPLACED by the panel's (it holds all of them: a field it left out
 * was cleared); an element exception of the symbol (`element` + `deviceId`, the Scene drawer's) is kept as it is; every other key of `map`, `hidden`, `view`
 * and `rules` is untouched. With no field left and no element exception the symbol's entry is removed. A device a field reads that the table does not hold
 * is added under `freshRole`; `addedRoles` names them (role to device) for the caller's record. Nothing is mutated.
 */
export function mergeSymbolEntry(binding: BindingParts, sceneKey: string, entry: SymbolEntryInput): MergeResult {
  if (typeof sceneKey !== 'string' || !SCENE_KEY_RE.test(sceneKey) || isUnsafeName(sceneKey)) return fail('invalid-key', 'the symbol has no usable name')
  const names = Object.keys(entry?.fields ?? {})
  if (names.length > MAX_FIELDS_PER_ENTRY) return fail('too-many-fields', `a symbol reads at most ${MAX_FIELDS_PER_ENTRY} values`)
  const fields: Record<string, SceneFieldRead> = {}
  for (const name of names) {
    const f = fieldOf(name, entry.fields[name])
    if ('problem' in f) return fail(f.problem, f.detail)
    fields[name] = f
  }
  const existing = Object.hasOwn(binding.map, sceneKey) ? binding.map[sceneKey] : undefined
  const devices: Record<string, string> = { ...binding.devices }
  const addedRoles: Record<string, string> = {}
  // a device a field, or one of its inputs (slice 16), reads that the table does not hold yet gets a role nobody sees
  const wanted = Object.values(fields).flatMap((f) => [f.deviceId, ...Object.values(f.inputs ?? {}).map((i) => i.deviceId)])
  for (const deviceId of wanted) {
    if (deviceId === undefined || roleOfDevice(devices, deviceId) !== undefined) continue
    const role = freshRole(devices)
    devices[role] = deviceId
    addedRoles[role] = deviceId
  }
  if (Object.keys(devices).length > MAX_BINDING_DEVICES) return fail('too-many-devices', `a scene holds at most ${MAX_BINDING_DEVICES} devices`)
  const kept: SceneMapEntry | null = existing?.element !== undefined && existing.deviceId !== undefined ? { deviceId: existing.deviceId, element: existing.element } : null
  const map: Record<string, SceneMapEntry> = { ...binding.map }
  if (names.length === 0 && !kept) delete map[sceneKey]
  else {
    if (!existing && Object.keys(binding.map).length >= MAX_BINDING_MAP) return fail('map-full', `a scene holds at most ${MAX_BINDING_MAP} symbols' setups`)
    map[sceneKey] = { ...(kept ?? {}), ...(names.length ? { fields } : {}) }
  }
  const merged = { ...binding, devices, map }
  if (bindingByteSize(merged) > MAX_BINDING_BYTES) return fail('too-large', 'the scene setup is too large to save')
  return { ok: true, devices, map, addedRoles }
}

/** The symbol's field map removed (its element exception, if any, stays; no entry is left empty); devices untouched. */
export function clearSymbolEntryFrom(binding: BindingParts, sceneKey: string): { devices: Record<string, string>; map: Record<string, SceneMapEntry>; changed: boolean } {
  const devices = { ...binding.devices }
  const existing = Object.hasOwn(binding.map, sceneKey) ? binding.map[sceneKey] : undefined
  if (!existing || !existing.fields) return { devices, map: { ...binding.map }, changed: false }
  const map = { ...binding.map }
  if (existing.element !== undefined && existing.deviceId !== undefined) map[sceneKey] = { deviceId: existing.deviceId, element: existing.element }
  else delete map[sceneKey]
  return { devices, map, changed: true }
}

/** Whether a symbol has a field map of its own (the panel's "bound"): an element exception alone is the Scene drawer's and does not count. */
export function hasFieldMap(map: Readonly<Record<string, SceneMapEntry>>, key: string): boolean {
  return Object.hasOwn(map, key) && !!map[key].fields && Object.keys(map[key].fields!).length > 0
}

/** The drawing's keys in the order "Next symbol" walks them: the symbols with no field map first, in the drawing's order, then the bound ones in theirs. */
export function symbolOrder(documentKeys: readonly string[], map: Readonly<Record<string, SceneMapEntry>>): string[] {
  const keys = [...new Set(documentKeys)]
  return [...keys.filter((k) => !hasFieldMap(map, k)), ...keys.filter((k) => hasFieldMap(map, k))]
}

/**
 * The symbol "Next symbol" moves to: the first symbol after `current` in the drawing's order (wrapping round) that has no field map; null when every symbol has
 * one (or the drawing has none). A `current` the drawing does not have starts from the top.
 */
export function nextUnboundKey(documentKeys: readonly string[], map: Readonly<Record<string, SceneMapEntry>>, current?: string | null): string | null {
  const keys = [...new Set(documentKeys)]
  if (keys.length === 0) return null
  const at = current ? keys.indexOf(current) : -1
  for (let n = 1; n <= keys.length; n++) {
    const key = keys[(at + n + keys.length) % keys.length]
    if (key !== current && !hasFieldMap(map, key)) return key
  }
  return null
}
