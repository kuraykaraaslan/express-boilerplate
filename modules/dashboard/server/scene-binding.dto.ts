import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import MSG from './dashboard.messages'
import { SUBJECT_ID_RE, SUBJECT_TYPE_RE } from './card-overlay'
import {
  DEFAULT_SLOT, MAX_BINDING_DEVICES, MAX_BINDING_MAP, MAX_FIELD_LABEL, MAX_FIELD_SCRIPT, MAX_FIELDS_PER_ENTRY, SCENE_KEY_RE, SCENE_KIND_RE, SCENE_ROLE_RE, SCENE_SLOT_RE, TELEMETRY_KEY_RE, UUID_RE,
  bindingProblems, isSymbolField, rawBodyProblems,
} from './scene-binding'

const subjectType = z.string().regex(SUBJECT_TYPE_RE, 'Invalid entity type')
/** A uuid subject is stored lower-cased, so the asset walk (which answers in lower case) finds the row whichever case a caller wrote. */
const subjectId = z.string().regex(SUBJECT_ID_RE, 'Invalid entity id').transform((s) => (UUID_RE.test(s) ? s.toLowerCase() : s))
const slot = z.string().regex(SCENE_SLOT_RE, 'Invalid slot')
const kind = z.string().regex(SCENE_KIND_RE, 'Invalid scene kind')
const uuid = z.string().regex(UUID_RE, 'Invalid id').transform((s) => s.toLowerCase())
const sceneKey = z.string().regex(SCENE_KEY_RE, 'Invalid scene key')

/** Role -> device id. A role is a key without a dot (`""` the main role); the object's own keys are checked here, not by the regex of a record. */
const DevicesSchema = z.record(z.string(), uuid).superRefine((v, ctx) => {
  const keys = Object.keys(v)
  if (keys.length > MAX_BINDING_DEVICES) ctx.addIssue({ code: 'custom', message: `At most ${MAX_BINDING_DEVICES} devices` })
  for (const k of keys) if (!SCENE_ROLE_RE.test(k)) ctx.addIssue({ code: 'custom', message: `Invalid role "${k}"`, path: [k] })
})

const telemetryKey = z.string().regex(TELEMETRY_KEY_RE, 'Invalid telemetry key')

/** One named input of a field's expression (slice 16, SU-3): a telemetry key of a bound device; `deviceId` absent: the field's device. */
const FieldInputSchema = z.object({ deviceId: uuid.optional(), key: telemetryKey }).strict()

/**
 * One field of a symbol read from one telemetry key of one bound device (phase 45, D45-3); `deviceId` absent: the entry's, else the key's role device.
 * `script` (45.3): one convert expression over `value`, `row` and `now`, at most `MAX_FIELD_SCRIPT` characters; WHAT it may say is judged by
 * `expressionProblems` inside `bindingProblems`, so the schema and the service refuse it with the same words and the path of the field. `inputs`
 * (slice 16): the expression's named inputs, at most `MAX_INPUTS_PER_FIELD`, their names judged by `inputNameProblems` in the same place; `key` is
 * then optional (a field reads a value, or an expression over its inputs, or both: `fieldHasSource`, judged there too).
 */
const FieldReadSchema = z.object({
  deviceId: uuid.optional(), key: telemetryKey.optional(), label: z.string().max(MAX_FIELD_LABEL).optional(), script: z.string().min(1).max(MAX_FIELD_SCRIPT).optional(),
  inputs: z.record(z.string(), FieldInputSchema).optional(),
}).strict()

/** The symbol fields of one entry, by field name (the symbol vocabulary or an item's own parameter); at most `MAX_FIELDS_PER_ENTRY`. */
const FieldsSchema = z.record(z.string(), FieldReadSchema).superRefine((v, ctx) => {
  const names = Object.keys(v)
  if (names.length > MAX_FIELDS_PER_ENTRY) ctx.addIssue({ code: 'custom', message: `At most ${MAX_FIELDS_PER_ENTRY} fields` })
  for (const f of names) if (!isSymbolField(f)) ctx.addIssue({ code: 'custom', message: `Invalid symbol field "${f}"`, path: [f] })
})

/**
 * One map entry (v2, phase 45): the element shortcut `{ deviceId, element }` (the only shape before, still valid: no stored row changes), a field map
 * `{ fields }` (with an optional default `deviceId`), or both. Neither is refused; an element without its device is refused (the shortcut reads that
 * device's whole row). Whether a field's device is one of the binding's devices is the route's check (`fieldDeviceProblems`, 422).
 */
export const MapEntrySchema = z.object({ deviceId: uuid.optional(), element: sceneKey.optional(), fields: FieldsSchema.optional() }).strict().superRefine((e, ctx) => {
  const withFields = !!e.fields && Object.keys(e.fields).length > 0
  if (e.element === undefined && !withFields) ctx.addIssue({ code: 'custom', message: 'An entry names an element, fields, or both' })
  if (e.element !== undefined && e.deviceId === undefined) ctx.addIssue({ code: 'custom', message: 'An element names its device', path: ['deviceId'] })
})

const MapSchema = z.record(z.string(), MapEntrySchema).superRefine((v, ctx) => {
  const keys = Object.keys(v)
  if (keys.length > MAX_BINDING_MAP) ctx.addIssue({ code: 'custom', message: `At most ${MAX_BINDING_MAP} map entries` })
  for (const k of keys) if (!SCENE_KEY_RE.test(k)) ctx.addIssue({ code: 'custom', message: `Invalid scene key "${k}"`, path: [k] })
})

const ViewSchema = z.object({ level: sceneKey.optional(), focus: sceneKey.optional() }).strict()

/**
 * PUT …/dashboard/scene-bindings: one subject's scene in one slot and kind. `devices`, `map`, `hidden`, `view` and `rules` replace
 * what is stored (a binding is saved whole, as the drawer holds it). `expectedRevision` is the revision the editor started from; 0 for
 * a binding that did not exist; absent = no check.
 */
export const SetSceneBindingDTO = z.object({
  subjectType,
  subjectId,
  slot: slot.default(DEFAULT_SLOT),
  kind,
  documentId: uuid,
  devices: DevicesSchema.default({}),
  map: MapSchema.default({}),
  hidden: z.array(sceneKey).max(MAX_BINDING_MAP).nullable().optional(),
  view: ViewSchema.nullable().optional(),
  rules: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
  expectedRevision: z.number().int().min(0).optional(),
}).strict().superRefine((v, ctx) => {
  for (const message of bindingProblems({ devices: v.devices, map: v.map, hidden: v.hidden ?? null, view: v.view ?? null, rules: v.rules ?? null }, v.kind)) {
    ctx.addIssue({ code: 'custom', message })
  }
  if (v.hidden && new Set(v.hidden).size !== v.hidden.length) ctx.addIssue({ code: 'custom', message: 'hidden: a key is named twice', path: ['hidden'] })
})
export type SetSceneBindingInput = z.infer<typeof SetSceneBindingDTO>

/**
 * POST …/dashboard/scene-bindings: a NEW view of a subject (47.1, D106). The body is a save's without `slot` and `expectedRevision`: the server stores it in
 * the next free slot of that subject and kind (`main`, then `view_2`, `view_3` …), so nobody names or types a slot. Judged as a save is.
 */
export const CreateSceneBindingDTO = z.object({
  subjectType,
  subjectId,
  kind,
  documentId: uuid,
  devices: DevicesSchema.default({}),
  map: MapSchema.default({}),
  hidden: z.array(sceneKey).max(MAX_BINDING_MAP).nullable().optional(),
  view: ViewSchema.nullable().optional(),
  rules: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
}).strict().superRefine((v, ctx) => {
  for (const message of bindingProblems({ devices: v.devices, map: v.map, hidden: v.hidden ?? null, view: v.view ?? null, rules: v.rules ?? null }, v.kind)) {
    ctx.addIssue({ code: 'custom', message })
  }
  if (v.hidden && new Set(v.hidden).size !== v.hidden.length) ctx.addIssue({ code: 'custom', message: 'hidden: a key is named twice', path: ['hidden'] })
})
export type CreateSceneBindingInput = z.infer<typeof CreateSceneBindingDTO>

/**
 * Reads the body of a save. The raw parsed JSON is looked at first: `JSON.parse` gives an own `__proto__` key, which the schema's
 * records would drop without a word, so a body carrying one is refused here (400) instead of being saved as if it had not.
 */
export function parseSetSceneBinding(raw: unknown): SetSceneBindingInput {
  const problems = rawBodyProblems(raw)
  if (problems.length) throw new AppError(MSG.SCENE_BINDING_INVALID, 400, ErrorCode.VALIDATION_ERROR, { details: { problems } })
  return SetSceneBindingDTO.parse(raw)
}

/** Reads the body of a create (47.1), refusing an own `__proto__` key first as `parseSetSceneBinding` does. */
export function parseCreateSceneBinding(raw: unknown): CreateSceneBindingInput {
  const problems = rawBodyProblems(raw)
  if (problems.length) throw new AppError(MSG.SCENE_BINDING_INVALID, 400, ErrorCode.VALIDATION_ERROR, { details: { problems } })
  return CreateSceneBindingDTO.parse(raw)
}

/** The query strings of GET / DELETE: a subject, a slot and a kind, or (GET) a kind and a document; DELETE may name `expectedRevision`. */
export const SceneBindingQuerySchema = z.object({
  expectedRevision: z.string().regex(/^\d{1,9}$/, 'Invalid revision').transform(Number).optional(),
  subjectType: subjectType.optional(),
  subjectId: subjectId.optional(),
  slot: slot.optional(),
  kind: kind.optional(),
  documentId: uuid.optional(),
}).strict()

/** `?cardDefault=true` on resolve: the card the answer is for has a default scene of its own. */
export const ResolveQuerySchema = z.object({
  subjectType,
  subjectId,
  slot: slot.default(DEFAULT_SLOT),
  kind,
  cardDefault: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
}).strict()

/** The params of a request as one plain object (`null` for an absent one is dropped, so `.optional()` reads it). */
export function queryObject(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of params.entries()) out[k] = v
  return out
}

/** The most documents one list answers (the kinds cap their own lists at 100 too). */
export const MAX_LISTED_DOCUMENTS = 100
/** The most keys one document answers; a document with more is cut and says so. */
export const MAX_LISTED_KEYS = 2000

/** `?kind=&search=&limit=` on the documents list: the drawer's table of a kind's documents. */
export const DocumentsQuerySchema = z.object({
  kind,
  search: z.string().trim().max(100).optional(),
  limit: z.string().regex(/^\d{1,3}$/, 'Invalid limit').transform(Number).pipe(z.number().int().min(1).max(MAX_LISTED_DOCUMENTS)).optional(),
}).strict()

/** `?kind=&documentId=` on the keys of one document: the equipment the drawer matches. */
export const DocumentKeysQuerySchema = z.object({ kind, documentId: uuid }).strict()

/** At most this many devices one drawing-links read names (the devices a card's rows name: `elements` reads at most 100). */
export const MAX_LINK_DEVICES = 100
const UUID_TEXT = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
/** `a,b,c`: 1 to `MAX_LINK_DEVICES` device ids, comma-separated, no spaces; lower-cased and distinct. */
const deviceIdList = z.string()
  .regex(new RegExp(`^${UUID_TEXT}(,${UUID_TEXT}){0,${MAX_LINK_DEVICES - 1}}$`), 'Invalid device ids')
  .transform((s) => [...new Set(s.toLowerCase().split(','))])

/**
 * `?kind=&documentId=[&deviceIds=]` on the links of one drawing (e2e run 1, E19): the one binding a card that draws this document of its own takes its links
 * from when no binding of its subject is for it. `deviceIds`: the devices the card shows (its data's, or its device page's), one of which the binding must
 * name (the review of E19: never another site's or another device's links for a card that shows its own devices).
 */
export const DocumentBindingQuerySchema = z.object({ kind, documentId: uuid, deviceIds: deviceIdList.optional() }).strict()

/**
 * The views a card's "Which view" setting offers (47.3): `?kind=` the slots in use across the tenant, named; `?subjectType=&subjectId=[&kind=]` one subject's
 * views by kind and drawing name (47.1). `slot` (with `kind`): the view a card stores, listed in words when the answer would not hold it (phase 47 review R47-3).
 * Which combination is valid is the route's call (400).
 */
export const SlotsQuerySchema = z.object({ kind: kind.optional(), subjectType: subjectType.optional(), subjectId: subjectId.optional(), slot: slot.optional() }).strict()

/** The most devices one bulk call binds (D42-7): the entity type answers at most this many at a time, so the call never reads or writes more. */
export const BULK_MAX_DEVICES = 500
/** Rows written in one transaction of a bulk call. */
export const BULK_CHUNK = 100

/**
 * POST …/scene-bindings/bulk: bind every device of a profile that has NO binding for (slot, kind) to one document (D42-7). `mapFrom` says how
 * the document's keys reach the device's elements: `identity` (the key is the element: no map, a keyed design) or `twin-index` (an item the
 * document labels with the element it was built from, `importScene`'s label, is mapped to that element; for a design without keys).
 */
export const BulkBindDTO = z.object({
  subjectType: z.literal('iot_device'),
  profileId: uuid,
  slot: slot.default(DEFAULT_SLOT),
  kind,
  documentId: uuid,
  mapFrom: z.enum(['identity', 'twin-index']).default('identity'),
  /**
   * Phase 45 slice 16 (D45-5): the field entries of one device's binding to apply to every device of the profile bound by this call (`copiedMapFor`:
   * the parts that read `copyFrom`, the source device, come along and read each target's own main role; what reads another device is dropped).
   * Judged by the map schema and, per device, by `bindingProblems` as every bulk row is. A device that already has a binding is still skipped.
   */
  copyMap: MapSchema.optional(),
  copyFrom: uuid.optional(),
}).strict()
export type BulkBindInput = z.infer<typeof BulkBindDTO>

/** GET …/scene-bindings/bulk?profileId=&kind=[&slot=]: how many devices of the profile have no binding yet (the drawer's count). */
export const BulkCountQuerySchema = z.object({ profileId: uuid, slot: slot.default(DEFAULT_SLOT), kind }).strict()
