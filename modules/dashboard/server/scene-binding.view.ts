/**
 * The view a hierarchy derives for a page (docs/phases/07-dashboard/42, D42-6, 42.4.1): one row on the top of a hierarchy (a building), and a
 * floor or room page below it shows the same document looking at its own level and room. Nothing is stored for that page; the view is worked
 * out from where the page's subject sits, so moving a room moves what its page shows.
 *
 * Pure: the caller walks the asset path and reads the document's keys (through the kind), this only decides which codes are which.
 */
import type { SceneKeyRef } from './scene-binding.types'

/** What a card looks at: a level (a floor) and a focus (a room). Both are keys of the document (D42-4: an asset's `code` is the key). */
export interface SceneView {
  level?: string
  focus?: string
}

/** The kinds of key the derivation reads: the document's levels and room tags (`keysOf` of the design kind answers them with these words). */
export const LEVEL_KEY_KIND = 'level'
export const ROOM_KEY_KIND = 'room'

/** Why a part of the view was left out: the document names a code twice (`ambiguous-key`), or the path names two levels or two rooms (`ambiguous-path`). */
export type SceneViewNote = 'ambiguous-key' | 'ambiguous-path'

export interface DerivedView {
  view?: SceneView
  /** Set when something that could have been a part of the view was left out because it cannot be told apart; the answer exposes it. */
  note?: SceneViewNote
}

/**
 * The view of a page whose subject sits at `path`: the codes of the assets below the one the binding is on, root first, down to the
 * subject (a device's path ends at the asset that holds it). A code that is a key of kind `level` in the document is the page's level; one
 * of kind `room` is its focus. A part that is named twice by the path (two levels, or two rooms, in one path) is ambiguous and left
 * out: a guess would draw the wrong floor. So is a code the document itself holds twice (a key flagged `ambiguous`: a level and an item, two
 * rooms, ...): it is no view part, and `note` says why. `view` is undefined when nothing was derived, so the card keeps its own settings.
 */
export function deriveViewOf(path: readonly string[], keys: readonly SceneKeyRef[]): DerivedView {
  const kindOf = new Map<string, string>()
  const ambiguousKeys = new Set<string>()
  for (const k of keys) {
    if (k.kind !== LEVEL_KEY_KIND && k.kind !== ROOM_KEY_KIND) continue
    if (k.ambiguous) ambiguousKeys.add(k.key)
    else kindOf.set(k.key, k.kind)
  }
  let note: SceneViewNote | undefined
  // an item that shares its key with a level or room is flagged on the level/room entry; a code in the path that is such a key names nothing
  if (path.some((code) => ambiguousKeys.has(code))) note = 'ambiguous-key'
  const pick = (kind: string): string | undefined => {
    const hits = [...new Set(path.filter((code) => !ambiguousKeys.has(code) && kindOf.get(code) === kind))]
    if (hits.length > 1) note ??= 'ambiguous-path'
    return hits.length === 1 ? hits[0] : undefined
  }
  const level = pick(LEVEL_KEY_KIND)
  const focus = pick(ROOM_KEY_KIND)
  const view = level !== undefined || focus !== undefined ? { ...(level !== undefined ? { level } : {}), ...(focus !== undefined ? { focus } : {}) } : undefined
  return { ...(view ? { view } : {}), ...(note ? { note } : {}) }
}

/** The view alone (`deriveViewOf` without the note). */
export function deriveView(path: readonly string[], keys: readonly SceneKeyRef[]): SceneView | undefined {
  return deriveViewOf(path, keys).view
}
