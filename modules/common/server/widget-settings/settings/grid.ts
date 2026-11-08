// Vendored from kui-react f7db139: modules/app/WidgetKit/settings/grid.ts. Do not edit a vendored copy; change it in kui-react (scripts/kui/vendor-widgetkit.mjs).
// A board's column count: 12 (the default, every board before it could choose) or 24 for a finer
// grid. The same definition as next-boilerplate's `modules/dashboard/server/grid-cols.ts` (phase
// 21.10): a change is not a look change but a rewrite of every card's `x`/`w` (`scaleLayout`).
// Pure and DOM-free (part of next-boilerplate's server copy of `settings/`).

export const GRID_COL_OPTIONS = [12, 24] as const;
export type GridCols = (typeof GRID_COL_OPTIONS)[number];
export const DEFAULT_GRID_COLS: GridCols = 12;
/** The widest grid any board can have. */
export const MAX_GRID_COLS: GridCols = 24;

/** A stored or received column count as one of the options; anything else is the default 12. */
export function normalizeGridCols(value: unknown): GridCols {
  return value === 24 ? 24 : DEFAULT_GRID_COLS;
}

/**
 * A width given on one grid (a widget type's `defaultW` is always "of 12") as the same share of
 * another, at least one column and never wider than the grid.
 */
export function scaleWidth(w: number, from: number, to: number): number {
  return Math.min(to, Math.max(1, Math.round((w * to) / from)));
}

export interface GridRect { id: string; x: number; y: number; w: number; h: number }

/** A card clamped into `cols` columns: never wider than the grid, never hanging off its right edge. */
export function fitRect<T extends GridRect>(item: T, cols: number): T {
  const w = Math.min(cols, Math.max(1, Math.trunc(item.w)));
  const x = Math.min(cols - w, Math.max(0, Math.trunc(item.x)));
  return item.w === w && item.x === x ? item : { ...item, x, w };
}

const overlap = (a: GridRect, b: GridRect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/**
 * Re-express a layout made on `from` columns on `to` columns. Both edges of each card scale and
 * round the same way, so two cards that touched still touch and each keeps its share of the width:
 * 12 → 24 is exact (every edge doubles); 24 → 12 rounds an odd edge, which can put two narrow
 * neighbours on the same column. Those are then pushed straight down (`resolveOverlaps`). Heights
 * and rows are untouched (a row is pixels, not a share of the width). Deterministic; with
 * `from === to` it only clamps.
 */
export function scaleLayout<T extends GridRect>(items: T[], from: number, to: number): T[] {
  if (from === to) return items.map((i) => fitRect(i, to));
  const scaled = items.map((raw) => {
    const item = fitRect(raw, from);
    const left = Math.round((item.x * to) / from);
    const right = Math.round(((item.x + item.w) * to) / from);
    return fitRect({ ...item, x: left, w: Math.max(1, right - left) }, to);
  });
  return resolveOverlaps(scaled);
}

/**
 * Push cards that overlap down, in (y, x, id) order, until none does. Nothing moves up or sideways
 * and sizes are kept; a layout without overlaps comes back unchanged (same objects, input order).
 */
export function resolveOverlaps<T extends GridRect>(items: T[]): T[] {
  const ordered = [...items].sort((a, b) => a.y - b.y || a.x - b.x || a.id.localeCompare(b.id));
  const placed: T[] = [];
  for (const item of ordered) {
    let y = item.y;
    let blocker = placed.find((p) => overlap({ ...item, y }, p));
    while (blocker) {
      y = blocker.y + blocker.h;
      blocker = placed.find((p) => overlap({ ...item, y }, p));
    }
    placed.push(y === item.y ? item : { ...item, y });
  }
  const byId = new Map(placed.map((p) => [p.id, p]));
  return items.map((i) => byId.get(i.id)!);
}
