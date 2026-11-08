import { z } from 'zod'
import { isColor } from '@kuraykaraaslan-labs/common/server/widget-settings/settings/style'
import { SYMBOL_MODES, SYMBOL_QUALITIES } from '@kuraykaraaslan-labs/common/server/widget-settings/views/scada-states'
import { MAX_PATCH_COLUMNS, PATCH_LINK_KINDS, type ScenePatch } from '@kuraykaraaslan-labs/common/server/widget-settings/views/scene-patch'
import { RULE_STATES, RULE_TURNS, type RuleTurn } from '@kuraykaraaslan-labs/common/server/widget-settings/views/scene-rules-logic'
import type { DataSourceResult } from './data-source.types'

/**
 * What a compute script may hand back (phase 35.5, POSTURE §14): `{ slots }`, each slot shaped like a source's
 * answer (`DataSourceResult`: scalar, series, table or record), and nothing else. The host validates the Worker's
 * result here BEFORE a view sees it, exactly as it would a source's answer, so a script can only ever produce what a
 * query could have produced. Pure and server-safe (the client runs it; a test pins it); no DOM, no request.
 *
 * Caps (ADR-0017 §3): 5 000 rows, 64 columns, 10 KiB per string, 2 MiB serialised in all. Unknown keys are refused
 * (strict), as are prototype member names as keys anywhere (`__proto__`, `constructor`, `prototype`): a row is read
 * with plain property lookups by the views. A slot's `fetchedAt`, `window`, `paging` and `ttlSeconds` are not the
 * script's to set: they are taken off what it returns (`LOADER_SLOT_KEYS`, a slot passed through carries them) and the host
 * carries the loaded slot's over, so a card's window badge stays what the server said.
 */
export const MAX_TRANSFORM_ROWS = 5_000
export const MAX_TRANSFORM_COLUMNS = 64
export const MAX_TRANSFORM_STRING_CHARS = 10 * 1024
export const MAX_TRANSFORM_OUTPUT_BYTES = 2 * 1024 * 1024
/** A card has a handful of slots; this only bounds a hostile result. */
export const MAX_TRANSFORM_SLOTS = 16
/** A cell may hold nested JSON (a map's position, a list of tags): this deep, this wide. */
export const MAX_TRANSFORM_CELL_DEPTH = 4
export const MAX_TRANSFORM_CELL_ITEMS = 256

const PROTOTYPE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])
const isSafeKey = (k: string) => !PROTOTYPE_KEYS.has(k)

const text = (max: number = MAX_TRANSFORM_STRING_CHARS) => z.string().max(max)
const key = (max: number) => z.string().min(1).max(max).refine(isSafeKey, 'Reserved key')
/**
 * A record of at most `max` plain keys; a prototype member name is refused here too, whatever the key schema did with it.
 * The keys are read off the RAW value, before the record parse: a JSON `"__proto__"` key is an own property of the parsed
 * result, but zod's record parse drops it silently (it never reaches the output), so a check on the output would let it
 * through (the same trap `BoardContextParamsSchema` guards against, security case 2026-10-18).
 */
const bounded = <T extends z.ZodTypeAny>(schema: T, max: number) => z.unknown().superRefine((r, ctx) => {
  if (r === null || typeof r !== 'object' || Array.isArray(r)) return
  const keys = Object.keys(r)
  if (keys.length > max) ctx.addIssue({ code: 'custom', message: `At most ${max} keys` })
  for (const k of keys) if (!isSafeKey(k)) ctx.addIssue({ code: 'custom', message: `"${k}" is a reserved key` })
}).pipe(schema)

/**
 * A cell's value: JSON only, every string bounded, nested at most `MAX_TRANSFORM_CELL_DEPTH` deep and
 * `MAX_TRANSFORM_CELL_ITEMS` wide, no prototype member names as keys. The message names the first problem.
 */
export function cellProblem(value: unknown, depth = 0): string | null {
  if (value === null || typeof value === 'boolean') return null
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'a number is not finite'
  if (typeof value === 'string') return value.length > MAX_TRANSFORM_STRING_CHARS ? `a string is longer than ${MAX_TRANSFORM_STRING_CHARS} characters` : null
  if (typeof value !== 'object') return `a ${typeof value} is not data`
  if (depth >= MAX_TRANSFORM_CELL_DEPTH) return `a value is nested deeper than ${MAX_TRANSFORM_CELL_DEPTH} levels`
  if (Array.isArray(value)) {
    if (value.length > MAX_TRANSFORM_CELL_ITEMS) return `a list holds more than ${MAX_TRANSFORM_CELL_ITEMS} items`
    for (const item of value) { const p = cellProblem(item, depth + 1); if (p) return p }
    return null
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return 'a value is not plain data'
  const keys = Object.keys(value)
  if (keys.length > MAX_TRANSFORM_CELL_ITEMS) return `an object holds more than ${MAX_TRANSFORM_CELL_ITEMS} keys`
  for (const k of keys) {
    if (!isSafeKey(k)) return `"${k}" is a reserved key`
    const p = cellProblem((value as Record<string, unknown>)[k], depth + 1)
    if (p) return p
  }
  return null
}

const cell = z.unknown().superRefine((v, ctx) => {
  const p = cellProblem(v)
  if (p) ctx.addIssue({ code: 'custom', message: p })
})

/** A row or a record: at most `MAX_TRANSFORM_COLUMNS` plain keys, each a bounded cell. */
const fields = bounded(z.record(key(100), cell), MAX_TRANSFORM_COLUMNS)

/** `ColumnMeta` (source-meta.ts), as a script may state it: every field bounded, nothing else. */
const metaLabel = z.union([text(200), bounded(z.record(key(16), text(200)), 32)])
const valueMapEntry = z.object({ label: text(200), color: text(64).optional(), icon: text(64).optional(), image: text(2000).optional() }).strict()
const metaFields = {
  unit: text(32).optional(),
  decimals: z.number().int().min(0).max(12).optional(),
  valueMap: bounded(z.record(key(200), valueMapEntry), 200).optional(),
  kind: z.enum(['number', 'boolean', 'enum', 'string', 'json']).optional(),
  direction: z.enum(['higherIsBetter', 'lowerIsBetter', 'neutral']).optional(),
}
const columnMeta = z.object({ label: metaLabel.optional(), ...metaFields }).strict()

/** A table column: `label` and `type` are filled in when the script leaves them out, as a view expects them. */
const column = z
  .object({ key: key(100), label: text(200).optional(), type: z.enum(['text', 'number', 'date', 'badge']).optional(), ...metaFields })
  .strict()
  .transform((c) => ({ ...c, label: c.label ?? c.key, type: c.type ?? 'text' }))

const scalar = z.object({ shape: z.literal('scalar'), value: z.union([text(), z.number().finite(), z.null()]).optional(), meta: columnMeta.optional() }).strict()
const series = z
  .object({
    shape: z.literal('series'),
    series: z
      .array(z.object({ name: text(200), points: z.array(z.object({ t: text(64), v: z.number().finite() }).strict()).max(MAX_TRANSFORM_ROWS), meta: columnMeta.optional() }).strict())
      .max(MAX_TRANSFORM_COLUMNS),
  })
  .strict()
const table = z
  .object({
    shape: z.literal('table'),
    columns: z.array(column).max(MAX_TRANSFORM_COLUMNS).optional(),
    rows: z.array(fields).max(MAX_TRANSFORM_ROWS),
    total: z.number().int().min(0).max(1_000_000_000).optional(),
  })
  .strict()
const record = z
  .object({ shape: z.literal('record'), record: fields, recordMeta: bounded(z.record(key(100), columnMeta), MAX_TRANSFORM_COLUMNS).optional() })
  .strict()

/** One returned slot: the data fields of a `DataSourceResult`, by shape. */
export const TransformSlotSchema = z.discriminatedUnion('shape', [scalar, series, table, record])
export type TransformSlot = z.infer<typeof TransformSlotSchema>

/** The slot key rule of a binding (`DataBindingSchema`): a slot, or `<slot>#n` for an extra source of a repeatable one. */
const slotKey = z.string().min(1).max(60).regex(/^[^#]+(#[2-8])?$/, 'Invalid slot key').refine(isSafeKey, 'Reserved key')

/**
 * `{ slots? }` and nothing else: a result that names anything but slots (an action, a parameter, a command) is refused.
 * `slots` is optional (an empty result draws the data as loaded) because the contract is `{ slots?, scene? }`: the scene
 * patch of E15 (phase 35.5b) joins it only for a card that draws a scene (`transformOutputSchemaFor`), without changing what
 * a result may not carry.
 */
const SLOTS = bounded(z.record(slotKey, TransformSlotSchema), MAX_TRANSFORM_SLOTS).optional()
export const TransformOutputSchema = z.object({ slots: SLOTS }).strict()
export type TransformOutput = z.infer<typeof TransformOutputSchema>

// ── The scene patch (phase 35.5b, E15) ─────────────────────────────────────────────────────────────────────────────────────
//
// Drawing instructions a script for a process diagram (`scada.scene`) or a 3D model (`viewer.model`) may return beside its
// slots: things, per-object overrides, extra connections and zones, the view, problems. Never an action: nothing in it names
// a parameter, a command, a page or a URL, and the views read it as data (labels as text, keys looked up in their registries;
// a symbol of a piece the tenant does not hold draws the placeholder, its pack is never served).
//
// THIS SCHEMA MUST AGREE WITH THE KIT'S `views/scene-patch.ts` (`parseScenePatch`, kui-react, phase 35.5b §B.5), vendored at
// `modules/common/server/widget-settings/views/scene-patch.ts`: its output IS the kit's `ScenePatch` type (the transform's return
// type; `ScenePatchOutput` below), and the view parses it again with `parseScenePatch` before the NB-owned `sceneModel`. What
// the host accepts the kit parser must keep whole: no shape kind but a title or a zone (no divider: the kit's `PatchShape` has
// none), thing cells and `params` plain values only (a string, a finite number, a yes / no, null; the kit drops anything
// nested), at most `MAX_PATCH_COLUMNS` (32) columns per thing under keys of the scene's id grammar, a thing id once, a colour
// the kit's `isColor` accepts, a mode, quality, state or turn of the kit's lists (a turn as its text, '90'), a symbol key and a
// connection id of the scene's id grammar, a medium a word. Anything the host accepts that the kit would drop is a bug here.
// Caps: things 500 (2D) / 2 000 (3D, the viewer's own), extra connections 300, extra zones and titles 100, object overrides
// 3 000 and problems 50 (the kit's), labels and problems 80 characters of plain text, ids of the scene's own grammar. A cap
// CUTS, it does not refuse (§B.4: the first ones and a problem count, never a blank): past a cap the first entries are kept, a
// thing row without a valid id (or with a bad cell, or an id an earlier row already has) is dropped, and each is counted in one
// line of the patch's problems, as `sceneModel` does with the things slot's rows. A malformed instruction (an unknown field, a
// bad connection end, a label that is not plain text, a divider) is still refused: that is the script's own bug, and the
// author learns it when the script runs, not from a problem line on the card.

/** The kinds whose script may return a scene patch, and how many things each draws at most. */
export const SCENE_PATCH_THING_CAPS: Readonly<Record<string, number>> = { 'scada.scene': 500, 'viewer.model': 2_000 }
export const MAX_PATCH_OBJECTS = 3_000
export const MAX_PATCH_LINKS = 300
export const MAX_PATCH_SHAPES = 100
export const MAX_PATCH_PROBLEMS = 50
export const MAX_PATCH_TEXT = 80
/** How far from the origin a patched coordinate may lie, and how far an offset may move, in scene units. */
export const MAX_PATCH_COORD = 10_000
export const MAX_PATCH_OFFSET = 4_000

/** Whether a card of this kind may receive a scene patch from its script. */
export const takesScenePatch = (kind: string | undefined): boolean => !!kind && Object.hasOwn(SCENE_PATCH_THING_CAPS, kind)

/** The id of a thing, symbol, connection or marker a patch addresses: the scene's own grammar, never a prototype member name. */
const objectId = z.string().regex(/^[A-Za-z0-9_.-]{1,64}$/, 'Invalid object id').refine(isSafeKey, 'Reserved key')
/** Plain text: bounded, no control characters (the views write it as text, never as markup). */
// eslint-disable-next-line no-control-regex
const plain = (max: number = MAX_PATCH_TEXT) => z.string().max(max).refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'Plain text only')
/** A finite number held inside `[lo, hi]` (the kit clamps the same effects). */
const clamped = (lo: number, hi: number) => z.number().finite().transform((n) => Math.min(hi, Math.max(lo, n)))
const coord = clamped(-MAX_PATCH_COORD, MAX_PATCH_COORD)
/** A plain value (the kit's `PatchScalar`): a thing's cell, an object's `value` or one of its `params`. Nothing nested. */
const scalarCell = z.union([text(200), z.number().finite(), z.boolean(), z.null()])
/** The scene's id grammar for a column, a param, a symbol key or a connection id (the kit's `SCENE_KEY`), never a prototype member name. */
const sceneKey = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/, 'Not an id of the scene').refine(isSafeKey, 'Reserved key')
/** A medium: a word (the kit's own test for an object's or a connection's medium). */
const medium = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/, 'Not a medium')
/** A colour the kit draws (`isColor`: hex, rgb(), hsl(), var(--token), transparent); anything else would be dropped there. */
const color = text(64).refine((v) => isColor(v), 'Not a colour')

/**
 * A thing: a row of the things contract (§B.4) as the kit's `PatchThing` reads it, at most `MAX_PATCH_COLUMNS` plain cells under
 * keys of the scene's grammar, with an id of the scene's grammar (or a number).
 */
const thingRow = bounded(z.record(sceneKey, scalarCell), MAX_PATCH_COLUMNS).superRefine((row, ctx) => {
  const id = (row as Record<string, unknown>).id
  const ok = (typeof id === 'string' && /^[A-Za-z0-9_.-]{1,64}$/.test(id) && isSafeKey(id)) || (typeof id === 'number' && Number.isFinite(id))
  if (!ok) ctx.addIssue({ code: 'custom', message: 'A thing needs an id (letters, digits, _ . - or a number)' })
})

/** One object's override: the 2D effects (a symbol or connection or thing of a diagram) and the 3D ones (a marker or thing). */
const objectPatch = z
  .object({
    state: z.enum(RULE_STATES).optional(),
    color: color.optional(),
    fillColor: color.optional(),
    hidden: z.boolean().optional(),
    dim: z.boolean().optional(),
    blink: z.boolean().optional(),
    label: plain().optional(),
    medium: medium.optional(),
    animate: z.boolean().optional(),
    mode: z.enum(SYMBOL_MODES).optional(),
    quality: z.enum(SYMBOL_QUALITIES).optional(),
    speed: clamped(0, 400).optional(),
    reverse: z.boolean().optional(),
    ack: z.boolean().optional(),
    position: clamped(0, 100).optional(),
    pending: z.boolean().optional(),
    failed: z.boolean().optional(),
    dx: clamped(-MAX_PATCH_OFFSET, MAX_PATCH_OFFSET).optional(),
    dy: clamped(-MAX_PATCH_OFFSET, MAX_PATCH_OFFSET).optional(),
    scale: clamped(0.2, 4).optional(),
    // A turn as the kit's `RuleTurn` text; a script may write the number (90), which is kept as its text ('90').
    turn: z.union([z.enum(RULE_TURNS), z.literal(0), z.literal(90), z.literal(180), z.literal(270)]).transform((t) => String(t) as RuleTurn).optional(),
    symbol: sceneKey.optional(),
    value: scalarCell.optional(),
    // 3D (`viewer.model`): a marker's or a thing's pulse, size, height offset and the design item's standard parameters.
    pulse: z.boolean().optional(),
    size: clamped(0.05, 100).optional(),
    dz: clamped(-MAX_PATCH_COORD, MAX_PATCH_COORD).optional(),
    params: bounded(z.record(sceneKey, scalarCell), MAX_PATCH_COLUMNS).optional(),
  })
  .strict()

/** An end of a connection: `<id>.<side>` or `<id>:<side>`, optionally `:<fraction>` (the scene's `parsePort`). */
const portRef = z.string().max(80).regex(/^\s*[A-Za-z_][A-Za-z0-9_.-]*?[.:][lrtb](?::(\d*\.?\d+))?\s*$/, 'Invalid connection end')
const linkPatch = z
  .object({ from: portRef, to: portRef, kind: z.enum(PATCH_LINK_KINDS), medium: medium.optional(), id: sceneKey.optional() })
  .strict()
/** A title or a zone (the kit's `PatchShape`; a divider is not one, so it is refused here rather than dropped on the card). */
const shapePatch = z
  .object({
    kind: z.enum(['text', 'zone']),
    x: coord, y: coord, w: clamped(0, 4_000).optional(), h: clamped(0, 4_000).optional(),
    text: plain().optional(),
    size: z.enum(['s', 'm', 'l']).optional(),
    align: z.enum(['start', 'middle', 'end']).optional(),
    tone: z.enum(['neutral', 'info', 'success', 'warning', 'error']).optional(),
    dashed: z.boolean().optional(),
  })
  .strict()
  .refine((h) => h.kind !== 'text' || !!h.text?.trim(), 'A title needs its words')
/** 2D: what to fit (the content, the whole canvas, or a region of at least 20 units each way). */
const view2d = z.union([
  z.literal('content'), z.literal('canvas'),
  z.object({ x0: coord, y0: coord, x1: coord, y1: coord }).strict().refine((b) => b.x1 - b.x0 >= 20 && b.y1 - b.y0 >= 20, 'The region is too small'),
])
/** 3D: a camera preset, or a target and a distance. */
const view3d = z.union([
  z.object({ preset: z.enum(['iso', 'top', 'front']) }).strict(),
  z.object({ target: z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]), distance: z.number().finite().positive().max(1_000_000) }).strict(),
])

/** One plain problem line for what a cap or a bad row left out, or none (the diagram lists it with its own problems). */
const leftOut = (n: number, what: string, why: string): string[] => (n > 0 ? [`${what} left out: ${n} (${why})`.slice(0, MAX_PATCH_TEXT)] : [])

/**
 * The scene patch a card of `kind` may receive (the 2D or 3D view, the kind's things cap). Past a cap the first entries are
 * kept and the rest counted; a thing row that is not a valid row (no id of the grammar, a bad cell) is dropped and counted,
 * because rows are data like the things slot's. The count lines come first in `problems`, before the script's own.
 */
export function scenePatchSchema(kind: string) {
  const thingCap = SCENE_PATCH_THING_CAPS[kind] ?? 0
  return z
    .object({
      // Unbounded here on purpose: the 2 MiB of the whole result bounds them; the caps cut below.
      things: z.array(z.unknown()).optional(),
      // Prototype member names are still refused key by key; only the count is cut, not refused.
      objects: bounded(z.record(objectId, objectPatch), Number.POSITIVE_INFINITY).optional(),
      links: z.array(linkPatch).optional(),
      shapes: z.array(shapePatch).optional(),
      view: (kind === 'viewer.model' ? view3d : view2d).optional(),
      problems: z.array(plain()).optional(),
    })
    .strict()
    // The output is the kit's `ScenePatch` exactly (the view's `WidgetViewProps.scenePatch`), so the type checker holds the two
    // layers together: a field the kit types more narrowly than this schema would not compile here.
    .transform(({ things, objects, links, shapes, problems, ...rest }): ScenePatch => {
      const notes: string[] = []
      const out: ScenePatch = { ...rest }
      if (things) {
        const kept: NonNullable<ScenePatch['things']> = []
        const seen = new Set<string>()
        let bad = 0
        let repeated = 0
        // Rows past the cap are not even parsed: they are counted as over it, whatever they hold.
        for (const row of things.slice(0, thingCap)) {
          const r = thingRow.safeParse(row)
          if (!r.success) { bad += 1; continue }
          // An id once (the kit drops a repeat; 7 and '7' are the same thing there).
          const id = String(r.data.id)
          if (seen.has(id)) { repeated += 1; continue }
          seen.add(id)
          kept.push(r.data)
        }
        out.things = kept
        notes.push(
          ...leftOut(bad, 'Things', 'no valid id, or a bad cell'),
          ...leftOut(repeated, 'Things', 'repeated id'),
          ...leftOut(Math.max(0, things.length - thingCap), 'Things', `over ${thingCap}`),
        )
      }
      if (objects) {
        const entries = Object.entries(objects)
        out.objects = Object.fromEntries(entries.slice(0, MAX_PATCH_OBJECTS))
        notes.push(...leftOut(entries.length - Object.keys(out.objects).length, 'Object overrides', `over ${MAX_PATCH_OBJECTS}`))
      }
      if (links) {
        out.links = links.slice(0, MAX_PATCH_LINKS)
        notes.push(...leftOut(links.length - out.links.length, 'Connections', `over ${MAX_PATCH_LINKS}`))
      }
      if (shapes) {
        out.shapes = shapes.slice(0, MAX_PATCH_SHAPES)
        notes.push(...leftOut(shapes.length - out.shapes.length, 'Titles and zones', `over ${MAX_PATCH_SHAPES}`))
      }
      // The count lines first, then the script's own problems in the room left; those past it are counted in the last line.
      const own = problems ?? []
      const room = MAX_PATCH_PROBLEMS - notes.length
      const shown = own.length > room ? [...own.slice(0, room - 1), ...leftOut(own.length - (room - 1), 'Problems', `over ${MAX_PATCH_PROBLEMS}`)] : own
      if (problems || notes.length) out.problems = [...notes, ...shown]
      return out
    })
}
/** What the host passes on: the kit's own `ScenePatch` (the schema's transform returns exactly that type). */
export type ScenePatchOutput = ScenePatch

/**
 * What a script for a card of `kind` may return: `{ slots?, scene? }` for a scene card (`scada.scene`, `viewer.model`),
 * `{ slots? }` for any other (a patch there is refused, not ignored, so the author learns it at once).
 */
export function transformOutputSchemaFor(kind: string | undefined) {
  if (!kind || !takesScenePatch(kind)) return TransformOutputSchema
  return z.object({ slots: SLOTS, scene: scenePatchSchema(kind).optional() }).strict()
}

export type TransformErrorCode = 'timeout' | 'throw' | 'invalid' | 'load'
export interface TransformError { code: TransformErrorCode; message: string }
export type TransformVerdict =
  | { ok: true; slots: Record<string, TransformSlot>; scene?: ScenePatchOutput }
  | { ok: false; error: TransformError }

/** The serialised size of a result, in UTF-8 bytes (what the 2 MiB cap counts). */
export function transformOutputBytes(json: string): number {
  return typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(json).length : json.length
}

/**
 * The keys the loader puts on every slot it hands a script (`fetchedAt`, `window`, `paging`, `ttlSeconds`, `stale`). They are the
 * host's, never the script's: a script that passes an input slot through (`{ ...slots.rows, rows }`) returns them unasked, so they
 * are taken off before the strict parse instead of refusing the result (phase 39, UX-27). `applyTransformSlots` carries the loaded
 * slot's own over. Any other unknown key is still refused.
 */
export const LOADER_SLOT_KEYS: readonly string[] = ['fetchedAt', 'window', 'paging', 'ttlSeconds', 'stale']

const isPlainRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** `raw` with the loader's keys taken off each returned slot; anything that is not `{ slots: { … } }` is returned as it is. */
function withoutLoaderKeys(raw: unknown): unknown {
  if (!isPlainRecord(raw) || !isPlainRecord(raw.slots)) return raw
  // Rebuilt with `Object.fromEntries` (own data properties): a `__proto__` key stays a key the schema then refuses.
  const slots = Object.fromEntries(Object.entries(raw.slots).map(([k, slot]) => [
    k, isPlainRecord(slot) ? Object.fromEntries(Object.entries(slot).filter(([f]) => !LOADER_SLOT_KEYS.includes(f))) : slot,
  ]))
  return { ...raw, slots }
}

/** The first issue of a refused result, as one bounded line (`slots.rows.rows.3.name: a string is longer than …`). */
function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'the result is not valid'
  const path = issue.path.map(String).join('.')
  return `${path ? `${path}: ` : ''}${issue.message}`.slice(0, 300)
}

/**
 * Judge a Worker's result as the host received it: JSON text (so it is parsed into plain data and measured before
 * anything reads it), at most `MAX_TRANSFORM_OUTPUT_BYTES`, then the schema for the card's `kind`
 * (`transformOutputSchemaFor`: a scene patch only for a scene card). Anything else is an `invalid` error the card shows;
 * nothing partial ever reaches a view, except a scene patch past one of its caps: that is cut and counted in its problems
 * (`scenePatchSchema`), as the things slot's rows are, never refused into a blank card.
 */
export function validateTransformOutput(json: unknown, kind?: string): TransformVerdict {
  if (typeof json !== 'string') return { ok: false, error: { code: 'invalid', message: 'the result is not data' } }
  const bytes = transformOutputBytes(json)
  if (bytes > MAX_TRANSFORM_OUTPUT_BYTES) {
    return { ok: false, error: { code: 'invalid', message: `the result (${bytes} bytes) is over the ${MAX_TRANSFORM_OUTPUT_BYTES}-byte limit` } }
  }
  let raw: unknown
  try { raw = JSON.parse(json) } catch { return { ok: false, error: { code: 'invalid', message: 'the result is not JSON' } } }
  raw = withoutLoaderKeys(raw)
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Object.hasOwn(raw, 'scene') && !takesScenePatch(kind)) {
    return { ok: false, error: { code: 'invalid', message: 'scene: a scene patch is only for a process diagram (scada.scene) or a 3D model (viewer.model) card' } }
  }
  const parsed = transformOutputSchemaFor(kind).safeParse(raw)
  if (!parsed.success) return { ok: false, error: { code: 'invalid', message: firstIssue(parsed.error) } }
  const scene = (parsed.data as { scene?: ScenePatchOutput }).scene
  return { ok: true, slots: parsed.data.slots ?? {}, ...(scene ? { scene } : {}) }
}

/**
 * The loaded data with the returned slots laid over it (the hook's one merge): a returned slot replaces the loaded
 * one whole (a table that became a series keeps no rows), with the loaded slot's `fetchedAt` and `window` carried
 * over so the card's freshness and window badge stay what the server said; a new slot is stamped `now`.
 */
export function applyTransformSlots(
  loaded: Record<string, DataSourceResult>,
  slots: Record<string, TransformSlot>,
  nowMs: number,
): Record<string, DataSourceResult> {
  const out: Record<string, DataSourceResult> = { ...loaded }
  for (const [slot, result] of Object.entries(slots)) {
    const before = loaded[slot]
    out[slot] = {
      ...(result as DataSourceResult),
      fetchedAt: before?.fetchedAt ?? new Date(nowMs).toISOString(),
      ...(before?.window ? { window: before.window } : {}),
    }
  }
  return out
}
