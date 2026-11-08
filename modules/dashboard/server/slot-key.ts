/**
 * Repeatable data slots (phase 18.3). A slot the widget declares `repeatable` may be bound to
 * several sources. The extra sources are stored under suffixed keys of the same `dataBinding`
 * object: `series` is the first, `series#2` the second, up to `series#8`. Each key is its own
 * query through the one runner, so every source keeps its own params, window and permission
 * gate, and everything that walks a binding (live topics, polling, `$param` references) already
 * handles it, because to them it is just another slot. Pure: no zod, no db.
 */
export const MAX_SLOT_SOURCES = 8
const SUFFIX = /^([^#]+)#([2-9])$/

/** `series#3` → `{ base: 'series', n: 3 }`; `series` → `{ base: 'series', n: 1 }`; `series#1`, `series#9` stay literal. */
export function splitSlotKey(key: string): { base: string; n: number } {
  const m = SUFFIX.exec(key)
  if (!m || Number(m[2]) > MAX_SLOT_SOURCES) return { base: key, n: 1 }
  return { base: m[1], n: Number(m[2]) }
}

export function slotKeyFor(base: string, n: number): string {
  return n <= 1 ? base : `${base}#${n}`
}

/** Every key of `data` that belongs to slot `base`, in source order (`series`, `series#2`, ...). */
export function slotKeysOf(base: string, keys: Iterable<string>): string[] {
  return [...keys]
    .filter((k) => splitSlotKey(k).base === base)
    .sort((a, b) => splitSlotKey(a).n - splitSlotKey(b).n)
}

/** The next free key for slot `base` among `keys`, or null at the cap. */
export function nextSlotKey(base: string, keys: Iterable<string>): string | null {
  const used = new Set(slotKeysOf(base, keys).map((k) => splitSlotKey(k).n))
  for (let n = 2; n <= MAX_SLOT_SOURCES; n += 1) if (!used.has(n)) return slotKeyFor(base, n)
  return null
}
