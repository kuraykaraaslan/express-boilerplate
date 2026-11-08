import { BUILTIN_KINDS } from '@kuraykaraaslan-labs/common/server/widget-settings/templates/index'

/**
 * The fewest rows a card of a builtin kind needs to show its content: the kind's `defaultH`. A card's header and body padding take
 * about 66 px, so a two-row card (88 px) has 22 px left, and a value with its label is cut off under the header. Only the kinds whose
 * content has a height of its own have this floor; the ones that draw to whatever size the card has (charts, maps, gauges, pictures,
 * diagrams) have none.
 */
const FLOWING_KINDS: ReadonlySet<string> = new Set([
  'stat.value', 'stat.attributes', 'stat.sparkline', 'state', 'progress',
  'control.button', 'control.switch', 'control.setpoint', 'control.slider', 'control.form',
  'content.markdown', 'content.links', 'data.table', 'data.feed',
])

export const MIN_CARD_ROWS: ReadonlyMap<string, number> = new Map(
  BUILTIN_KINDS.filter((k) => FLOWING_KINDS.has(k.type)).map((k) => [k.type, k.defaultH]),
)

export interface SizedPlacement {
  pageKey?: string | null
  type?: string
  widgetRef?: string
  title?: string | null
  h: number
  settings?: unknown
}

/**
 * The rows a card needs: its kind's floor, and for an attribute list (`stat.attributes`, list layout: one 36 px row a field) as many rows as
 * its fields need under the 74 px of header, padding and border (a row of the grid is 40 px with an 8 px gap: `48h - 8` px). The other
 * layouts put the fields side by side and fit the kind's floor.
 */
export function minRowsOf(p: SizedPlacement): number | undefined {
  const kind = kindOf(p)
  const floor = kind ? MIN_CARD_ROWS.get(kind) : undefined
  if (floor === undefined || kind !== 'stat.attributes') return floor
  const s = (p.settings ?? {}) as { layout?: string; fields?: unknown[] }
  if ((s.layout ?? 'list') !== 'list' || !Array.isArray(s.fields)) return floor
  return Math.max(floor, Math.ceil((74 + 36 * s.fields.length + 8) / 48))
}

const kindOf = (p: SizedPlacement): string | null =>
  p.type ?? (p.widgetRef?.startsWith('builtin:') ? p.widgetRef.slice('builtin:'.length) : null)

/** The cards of `placements` shorter than their kind needs, each as one readable line under `where`. */
export function cardsTooShort(where: string, placements: readonly SizedPlacement[]): string[] {
  return placements.flatMap((p) => {
    const kind = kindOf(p)
    const min = minRowsOf(p)
    return min !== undefined && p.h < min ? [`${where} · ${p.pageKey ?? 'first page'} · "${p.title || kind}" (${kind}) is ${p.h} rows, needs ${min}`] : []
  })
}

/** Every pair of cards on one page of `placements` that cover a common cell, each as one readable line under `where`. */
export function cardsOverlapping(where: string, placements: ReadonlyArray<SizedPlacement & { x: number; y: number; w: number }>): string[] {
  return placements.flatMap((a, i) => placements.slice(i + 1)
    .filter((b) => (a.pageKey ?? null) === (b.pageKey ?? null) && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h)
    .map((b) => `${where} · ${a.pageKey ?? 'first page'} · "${a.title || kindOf(a)}" and "${b.title || kindOf(b)}" cover the same cells`))
}
