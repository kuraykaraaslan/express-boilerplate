/**
 * Which row a row source's click is on, by id (phase 35.2, E14): the slot a source's rows come from and the column that
 * identifies a row of it. Pure and shared: the client reads the id it sends with these (`ui/row-command.ts`), the run
 * route looks the re-read row up with the same (`command-row.ts`), so the two can never disagree about the column.
 */

/** Which slot of a placement a row source's clicked row comes from, by widget kind and source (first bound one wins). */
export function rowSlotsFor(kindType: string | undefined, sourceKey: string, boundSlots: readonly string[]): string[] {
  let wanted: string[]
  if (sourceKey === 'rowClick' || sourceKey === 'rowDoubleClick' || sourceKey === 'cellClick' || sourceKey === 'actionCellButton') wanted = ['rows']
  else if (sourceKey === 'sliceClick') wanted = ['slices']
  else if (sourceKey === 'markerClick') wanted = kindType === 'viewer.model' ? ['sensors', 'things'] : kindType === 'map' ? ['points'] : ['points', 'sensors', 'things']
  // A widget-declared row source (`<widget>.<name>`) names no slot: its row is the placement's one bound table, or none.
  else wanted = boundSlots.length === 1 ? [...boundSlots] : []
  return wanted.filter((s) => boundSlots.includes(s))
}

/**
 * The column that identifies a row of a slot: the widget's own `idColumn` setting where it has one (a map's points, a
 * 3D model's sensors), `id` otherwise (a table, a pie's slices, a model's things), the same column the client reads
 * the id it sends from (`ui/row-command.ts`).
 */
export function rowIdColumnFor(settings: unknown, slot: string): string {
  const own = settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as { idColumn?: unknown }).idColumn : undefined
  if (slot !== 'things' && typeof own === 'string' && own.trim() !== '') return own.trim()
  return 'id'
}

/** A row's id as the client sends it: the id cell as text, or null when the row has no plain id. */
export function rowIdOf(row: Record<string, unknown> | null | undefined, column: string): string | null {
  if (!row || typeof row !== 'object' || !Object.prototype.hasOwnProperty.call(row, column)) return null
  const v = row[column]
  return typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v) : null
}
