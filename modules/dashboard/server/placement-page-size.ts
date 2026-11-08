import { builtinTypeOfComponent } from './builtin-component-files'

/** The builtin kinds that draw a server-paged table and read `maxRows` as their rows per page. */
const PAGED_TABLE_TYPES = new Set(['data.table'])

/**
 * The page size a placement asks a server-paged query for (decision 2026-10-17 #5a): the card's "Rows per page"
 * (`maxRows`), as stored on the placement or on the preset it was placed from. Only a value someone SET counts, so
 * an untouched card keeps the query's own default page size. `resolvePaging` clamps it to the query's maximum.
 */
export function placementPageSize(
  widget: { componentId?: string | null; defaultProps?: Record<string, unknown> | null } | undefined,
  settings: unknown,
): number | undefined {
  const type = builtinTypeOfComponent(widget?.componentId)
  if (!type || !PAGED_TABLE_TYPES.has(type)) return undefined
  const own = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).maxRows : undefined
  const raw = own ?? widget?.defaultProps?.maxRows
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : undefined
}
