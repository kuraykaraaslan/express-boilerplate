/**
 * Views by name (docs/phases/07-dashboard/47, D106): a person knows a view of a device or a site by its type and its drawing's name ("3D view · Pool
 * plant · Ankara"), never by the slot that stores it. These pure functions turn binding rows into the labels the slots route answers: one subject's
 * views (the Scene tab's switch, a card bound to that subject), and the views in use across the tenant (a card that follows its page's subject, which is
 * only known when the page runs). The words come from the caller in the request's language (`sceneViewWords`).
 */
import { DEFAULT_SLOT, slotOrdinal } from './scene-binding'

/** The words a label is made of, in one language. */
export interface SceneViewWords {
  /** A kind's word: "3D view", "2D drawing"; any other kind a plain "View". */
  kind: (kind: string) => string
  /** The first allocated view of a kind (`main`, D106): "First 3D view". */
  first: (kind: string) => string
  /** The n-th allocated view of a kind (`view_n`): "3D view 3". */
  nth: (kind: string, n: number) => string
  /** A view whose drawing was deleted. */
  gone: string
  /** How many more drawings a tenant-wide entry stands for: "+3 more". */
  more: (count: number) => string
  /**
   * A view a card stores that the answer does not hold (phase 47 review R47-3): on one subject "not set up on this device" / "… on this site" / "… here"
   * (by its type), across the tenant (no type) "not set up anywhere".
   */
  notSetUp: (subjectType?: string) => string
}

/** One view of a subject as the slots route answers it (47.1): the slot is the row key (a card stores it), the rest is what a person reads. */
export interface SubjectView {
  slot: string
  kind: string
  documentId: string
  documentName: string | null
  status: 'ok' | 'unresolved'
  /** The view's own part of the label: the drawing's name with its "(2)" (or that the drawing was deleted); null when nothing could be read of it. */
  name: string | null
  /** What a person reads: "<kind word> · <name>". */
  label: string
}

/** The joint of a label: kind, then name. */
const JOIN = ' · '

/**
 * The order a subject's views are listed in: by kind as given (`kindOrder`, unknown kinds after), then by the allocation order of the slot (`main`, `view_2`,
 * `view_3` …), then the slots named by hand, by name. Pure.
 */
export function compareViews(kindOrder: readonly string[]) {
  const rank = (k: string) => { const i = kindOrder.indexOf(k); return i < 0 ? kindOrder.length : i }
  return (a: { slot: string; kind: string }, b: { slot: string; kind: string }): number => {
    if (a.kind !== b.kind) return rank(a.kind) - rank(b.kind) || (a.kind < b.kind ? -1 : 1)
    const oa = slotOrdinal(a.slot)
    const ob = slotOrdinal(b.slot)
    if (oa !== null && ob !== null) return oa - ob
    if (oa !== null) return -1
    if (ob !== null) return 1
    return a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0
  }
}

/**
 * The labels of ONE subject's views (47.2): "<kind word> · <drawing name>". Two views whose labels would read the same are told apart by "(2)", "(3)" …
 * in the listing order, the only time a number shows; the first has none. The count is by the label shown (test 3 #34, #40, #51): two views of one
 * drawing, and two drawings that share a name ("FV1" twice), alike. A view whose drawing was deleted says so; a drawing whose name the caller could not
 * read shows the kind word alone. Sorted by `compareViews`. Pure.
 */
export function subjectViewsOf(
  rows: ReadonlyArray<{ slot: string; kind: string; documentId: string; status: 'ok' | 'unresolved' }>,
  nameOf: (kind: string, documentId: string) => string | null,
  words: SceneViewWords,
  kindOrder: readonly string[] = [],
): SubjectView[] {
  const seen = new Map<string, number>()
  return [...rows].sort(compareViews(kindOrder)).map((r) => {
    const documentName = r.status === 'ok' ? nameOf(r.kind, r.documentId) : null
    const shown = r.status !== 'ok' ? words.gone : documentName
    // numbered by what a person reads, never by the drawing behind it: two views that would read alike are told apart
    const read = `${words.kind(r.kind)}${JOIN}${shown ?? ''}`
    const nth = (seen.get(read) ?? 0) + 1
    seen.set(read, nth)
    const suffix = nth > 1 ? ` (${nth})` : ''
    const name = shown ? `${shown}${suffix}` : null
    const label = `${words.kind(r.kind)}${name ? `${JOIN}${name}` : suffix}`
    return { slot: r.slot, kind: r.kind, documentId: r.documentId, documentName, status: r.status, name, label }
  })
}

/**
 * The view a card stores, kept in its "Which view" list when the subject's views do not hold it (phase 47 review R47-3): a slot typed by hand on another
 * device, or a second view this device does not have. Appended as "<kind word> · not set up on this device", so the picker never falls back to showing the
 * slot itself. The list as it is when `stored` is absent or already listed. Pure.
 */
export function withStoredView(
  slots: ReadonlyArray<{ slot: string; label: string }>, kind: string, stored: string | undefined, subjectType: string, words: SceneViewWords,
): Array<{ slot: string; label: string }> {
  if (!stored || slots.some((s) => s.slot === stored)) return [...slots]
  return [...slots, { slot: stored, label: `${words.kind(kind)}${JOIN}${words.notSetUp(subjectType)}` }]
}

/** At most this many drawing names a tenant-wide entry lists; the rest are counted ("+3 more"). */
export const NAMES_PER_SLOT = 2

/**
 * The labels of the slots of one kind in use across the tenant (47.3), for a card whose subject is only known when its page runs: `main` is "First 3D
 * view", `view_n` is "3D view n", a slot named by hand is the kind word; each is followed by the names of the drawings it holds there, the most used
 * first (at most `NAMES_PER_SLOT`, then "+N more"). `main` is always listed first (the card's default); a slot with no drawing the caller may read keeps
 * its words alone. `stored` (the slot the card holds, phase 47 review R47-3): when no binding of the tenant uses it, it is listed too, its words followed by
 * "not set up anywhere", so the picker never shows the slot itself. Sorted by `compareViews`. Pure.
 */
export function tenantSlotLabels(
  kind: string,
  slots: readonly string[],
  uses: ReadonlyArray<{ slot: string; documentId: string; n: number }>,
  nameOf: (documentId: string) => string | null,
  words: SceneViewWords,
  stored?: string,
): Array<{ slot: string; label: string }> {
  const inUse = new Set([DEFAULT_SLOT, ...slots, ...uses.map((u) => u.slot)])
  const unused = stored && !inUse.has(stored) ? stored : null
  const all = unused ? [...inUse, unused] : [...inUse]
  const byDoc = new Map<string, Map<string, number>>()
  for (const u of uses) {
    const docs = byDoc.get(u.slot) ?? new Map<string, number>()
    docs.set(u.documentId.toLowerCase(), (docs.get(u.documentId.toLowerCase()) ?? 0) + u.n)
    byDoc.set(u.slot, docs)
  }
  return all.map((slot) => ({ slot, kind })).sort(compareViews([kind])).map(({ slot }) => {
    const ordinal = slotOrdinal(slot)
    const base = ordinal === 1 ? words.first(kind) : ordinal !== null ? words.nth(kind, ordinal) : words.kind(kind)
    const names: string[] = []
    for (const [id] of [...(byDoc.get(slot) ?? new Map<string, number>())].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
      const name = nameOf(id)
      if (name && !names.includes(name)) names.push(name)
    }
    if (slot === unused) return { slot, label: `${base}${JOIN}${words.notSetUp()}` }
    const shown = names.slice(0, NAMES_PER_SLOT)
    const more = names.length - shown.length
    return { slot, label: shown.length ? `${base}${JOIN}${shown.join(', ')}${more > 0 ? ` ${words.more(more)}` : ''}` : base }
  })
}
