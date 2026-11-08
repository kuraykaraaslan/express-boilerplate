import { z } from 'zod'

/**
 * A board's column count (phase 21.10): 12 (the default, every board before 21.10) or 24 for a
 * finer grid. Stored in the existing `dashboard_boards.gridCols` column rather than in the
 * `core:board` settings: the column was already there (seeded 12), the server needs it to bound
 * geometry on every write, and changing it is not a look change but a rewrite of every
 * placement's `x`/`w` (`scaleLayout`), which the settings engine has no place for.
 *
 * Pure and DOM-free so the server (DTO bounds, the column change, package import) and the editor
 * (`ui/board-layout.ts`) share one definition.
 */
export const GRID_COL_OPTIONS = [12, 24] as const
export type GridCols = (typeof GRID_COL_OPTIONS)[number]
export const DEFAULT_GRID_COLS: GridCols = 12
/** The widest grid any board can have: the static bound of the geometry DTOs. */
export const MAX_GRID_COLS: GridCols = 24

export const GridColsSchema = z.union([z.literal(12), z.literal(24)])

/** A stored or received column count as one of the options; anything else is the default 12. */
export function normalizeGridCols(value: unknown): GridCols {
  return value === 24 ? 24 : DEFAULT_GRID_COLS
}

/** Whether a card's horizontal geometry lies inside a grid of `cols` columns (the DTOs bound `w` below). */
export function fitsGrid(g: { x: number; w: number }, cols: number): boolean {
  return g.x >= 0 && g.x + g.w <= cols
}

/**
 * A width given on one grid (a widget's `defaultW` is always "of 12") as the same share of
 * another, at least one column and never wider than the grid.
 */
export function scaleWidth(w: number, from: number, to: number): number {
  return Math.min(to, Math.max(1, Math.round((w * to) / from)))
}

export interface GridRect { id: string; x: number; y: number; w: number; h: number }

/** A card clamped into `cols` columns: never wider than the grid, never hanging off its right edge. */
export function fitRect<T extends GridRect>(item: T, cols: number): T {
  const w = Math.min(cols, Math.max(1, Math.trunc(item.w)))
  const x = Math.min(cols - w, Math.max(0, Math.trunc(item.x)))
  return item.w === w && item.x === x ? item : { ...item, x, w }
}

const overlap = (a: GridRect, b: GridRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/**
 * Re-express a layout made on `from` columns on `to` columns. Both edges of each card scale and
 * round the same way, so two cards that touched still touch and the share of the width each one
 * holds is kept: 12 → 24 is exact (every edge doubles); 24 → 12 rounds an odd edge up, which can
 * make two narrow neighbours land on the same column. Those are then pushed straight down, in
 * `(y, x, id)` order, until nothing overlaps; nothing is pulled up, so a gap someone left on
 * purpose stays. Heights and rows are untouched (a row is pixels, not a share of the width).
 * Deterministic, and a no-op when `from === to`.
 */
export function scaleLayout<T extends GridRect>(items: T[], from: number, to: number): T[] {
  if (from === to) return items.map((i) => fitRect(i, to))
  const scaled = items.map((raw) => {
    const item = fitRect(raw, from)
    const left = Math.round((item.x * to) / from)
    const right = Math.round(((item.x + item.w) * to) / from)
    return fitRect({ ...item, x: left, w: Math.max(1, right - left) }, to)
  })
  return resolveOverlaps(scaled)
}

/**
 * Push cards that overlap down, in (y, x, id) order, until none does. Nothing moves up or sideways and sizes are
 * kept; a layout without overlaps comes back unchanged. Shared by the column rescale and the package import,
 * where cards clamped into the grid one by one may land on the same cells.
 */
export function resolveOverlaps<T extends GridRect>(items: T[]): T[] {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id))
  const placed: T[] = []
  for (const item of ordered) {
    let y = item.y
    let blocker = placed.find((p) => overlap({ ...item, y }, p))
    while (blocker) {
      y = blocker.y + blocker.h
      blocker = placed.find((p) => overlap({ ...item, y }, p))
    }
    placed.push(y === item.y ? item : { ...item, y })
  }
  const byId = new Map(placed.map((p) => [p.id, p]))
  return items.map((i) => byId.get(i.id)!)
}

/**
 * Run a layout function on each in-board page separately (D-1 (a)) and return the items in their input order.
 * Cards on different pages never share a grid, so a rescale or an overlap fix must not push one page's card below
 * another page's. `pageOf` returns the page key, `null` for the main page.
 */
export function perPage<T extends GridRect>(items: T[], pageOf: (item: T) => string | null | undefined, fn: (page: T[]) => T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = pageOf(item) ?? ''
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const byId = new Map<string, T>()
  for (const group of groups.values()) for (const out of fn(group)) byId.set(out.id, out)
  return items.map((i) => byId.get(i.id)!)
}

