/**
 * Card overlays (docs/phases/07-dashboard/38, E38-7..E38-9): a card's settings for ONE subject entity (the device a page shows), kept as a
 * JSON merge patch (RFC 7396) on the card's own settings: objects merge key by key, arrays and values replace, `null` removes a key, so a
 * station's own diagram replaces the board's elements while every other setting of the card still follows the board.
 *
 * Pure: the service, the viewer, the display and the tests share these rules.
 */

/** A board parameter as the subject rule reads it: its key and the entity type it names (both kinds, phase 41). */
type SubjectParam = { key: string; entityType?: string }

/** At most this many overlays per card (one per subject; a board of 200 stations stays well under it). */
export const MAX_OVERLAYS_PER_CARD = 2000
/** A patch is at most as deep as this (a scene's elements sit at depth 3). */
export const MAX_PATCH_DEPTH = 12
/** A subject's id, as the entity types use them. */
export const SUBJECT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
/** A subject's entity type key, as a board parameter's `entityType` names it. */
export const SUBJECT_TYPE_RE = /^[a-z][a-z0-9_.-]{0,59}$/

/** Keys a patch may never name (they would reach an object's prototype while merging). */
export const UNSAFE_KEY = /^(?:__proto__|constructor|prototype)$/

/** True when any object in `v` has a key a patch may not name. */
export function hasUnsafeKeys(v: unknown): boolean {
  if (Array.isArray(v)) return v.some(hasUnsafeKeys)
  if (typeof v !== 'object' || v === null) return false
  return Object.keys(v).some((k) => UNSAFE_KEY.test(k) || hasUnsafeKeys((v as Record<string, unknown>)[k]))
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type JsonObject = { [key: string]: Json }

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v)

/** The settings a card shows for a subject: `patch` applied to `base` (RFC 7396). Neither argument is changed. */
export function applyMergePatch<T extends Record<string, unknown>>(base: T | null | undefined, patch: unknown): T {
  return mergeValue(base ?? {}, patch) as T
}

function mergeValue(target: unknown, patch: unknown): unknown {
  if (!isObject(patch)) return patch
  const out: Record<string, unknown> = isObject(target) ? { ...target } : {}
  for (const [key, value] of Object.entries(patch)) {
    if (UNSAFE_KEY.test(key)) continue
    if (value === null) delete out[key]
    else out[key] = mergeValue(out[key], value)
  }
  return out
}

/** The smallest merge patch that turns `base` into `target`; `{}` when they are equal. */
export function createMergePatch(base: Record<string, unknown> | null | undefined, target: Record<string, unknown>): Record<string, unknown> {
  return diffObjects(base ?? {}, target)
}

function diffObjects(base: Record<string, unknown>, target: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const key of Object.keys(base)) if (!(key in target)) patch[key] = null
  for (const [key, value] of Object.entries(target)) {
    const before = base[key]
    if (sameJson(before, value)) continue
    patch[key] = isObject(before) && isObject(value) ? diffObjects(before, value) : value
  }
  return patch
}

/** Deep equality of two JSON values (object key order does not matter, array order does). */
export function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((v, i) => sameJson(v, b[i]))
  }
  if (!isObject(a) || !isObject(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => k in b && sameJson(a[k], b[k]))
}

/** How deep a JSON value nests (a value is 0, `{a: 1}` is 1). */
export function jsonDepth(v: unknown): number {
  if (Array.isArray(v)) return 1 + Math.max(0, ...v.map(jsonDepth))
  if (isObject(v)) return 1 + Math.max(0, ...Object.values(v).map(jsonDepth))
  return 0
}

/** The top-level keys a patch touches (what the audit records). */
export const patchKeys = (patch: Record<string, unknown>): string[] => Object.keys(patch).sort()

/** A page's subject: the entity the page shows (E38-7). */
export interface CardSubject {
  type: string
  id: string
}

/**
 * The subject of a page shown with `values`: its first input whose board param names an entity type, with that param's value. Null
 * for a page without such an input or while the input is empty (the board's own settings then).
 */
export function pageSubject(
  pages: ReadonlyArray<{ key: string; inputs?: ReadonlyArray<{ param: string }> }> | null | undefined,
  pageKey: string | null,
  params: ReadonlyArray<SubjectParam> | null | undefined,
  values: Readonly<Record<string, unknown>>,
): CardSubject | null {
  if (!pageKey) return null
  const page = (pages ?? []).find((p) => p.key === pageKey)
  for (const input of page?.inputs ?? []) {
    const def = (params ?? []).find((p) => p.key === input.param)
    if (!def?.entityType) continue
    const value = values[input.param]
    const id = Array.isArray(value) ? value[0] : value
    return typeof id === 'string' && SUBJECT_ID_RE.test(id) ? { type: def.entityType, id } : null
  }
  return null
}

/** The key a viewer caches a subject's overlays under. */
export const subjectKey = (s: CardSubject): string => `${s.type}:${s.id}`
