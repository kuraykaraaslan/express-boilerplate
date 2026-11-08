import type { ColumnMeta, DataSourceResult, DataSourceQueryDef } from './data-source.types'

/**
 * Column meta (phase 23): what a query says about its own values. Pure; no db, no env.
 *
 * A source is first-party code, but its meta travels to every viewer's browser, so it is bounded and
 * typed here once, in the runner's path: a bad entry is dropped, never rendered. Colours and icons are
 * only strings here; the widget kit validates them again where it draws them.
 */

const MAX_TEXT = 120
const MAX_ENTRIES = 200
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const KINDS = new Set(['number', 'boolean', 'enum', 'string', 'json'])
const DIRECTIONS = new Set(['higherIsBetter', 'lowerIsBetter', 'neutral'])

const text = (v: unknown, max = MAX_TEXT): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.slice(0, max) : undefined

function label(v: unknown): ColumnMeta['label'] {
  const single = text(v)
  if (single !== undefined) return single
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const out: Record<string, string> = {}
  for (const [lang, t] of Object.entries(v).slice(0, 16)) {
    const clean = text(t)
    if (LANG.test(lang) && clean !== undefined) out[lang] = clean
  }
  return Object.keys(out).length ? out : undefined
}

/** A well-formed `ColumnMeta`, or undefined when nothing usable is left. */
export function sanitizeColumnMeta(input: unknown): ColumnMeta | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const m = input as Record<string, unknown>
  const out: ColumnMeta = {}
  const l = label(m.label)
  if (l !== undefined) out.label = l
  const unit = text(m.unit, 16)
  if (unit !== undefined) out.unit = unit
  if (typeof m.decimals === 'number' && Number.isInteger(m.decimals) && m.decimals >= 0 && m.decimals <= 10) out.decimals = m.decimals
  if (typeof m.kind === 'string' && KINDS.has(m.kind)) out.kind = m.kind as ColumnMeta['kind']
  if (typeof m.direction === 'string' && DIRECTIONS.has(m.direction)) out.direction = m.direction as ColumnMeta['direction']
  // The range the value is declared to take (a gauge's default scale): finite ends only, and none of it when it is empty
  // (a minimum not below the maximum). A source fills it from what it knows of the value; the dashboard only passes it on.
  const min = typeof m.min === 'number' && Number.isFinite(m.min) ? m.min : undefined
  const max = typeof m.max === 'number' && Number.isFinite(m.max) ? m.max : undefined
  if (min === undefined || max === undefined || min < max) {
    if (min !== undefined) out.min = min
    if (max !== undefined) out.max = max
  }
  if (m.valueMap && typeof m.valueMap === 'object' && !Array.isArray(m.valueMap)) {
    const map: NonNullable<ColumnMeta['valueMap']> = {}
    for (const [raw, e] of Object.entries(m.valueMap).slice(0, MAX_ENTRIES)) {
      if (!e || typeof e !== 'object' || raw.length > 64) continue
      const entry = e as Record<string, unknown>
      const word = text(entry.label)
      if (word === undefined) continue
      const color = text(entry.color, 64)
      const icon = text(entry.icon, 64)
      map[raw] = { label: word, ...(color ? { color } : {}), ...(icon ? { icon } : {}) }
    }
    if (Object.keys(map).length) out.valueMap = map
  }
  return Object.keys(out).length ? out : undefined
}

function sanitizeRecord(input: unknown): Record<string, ColumnMeta> | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined
  const out: Record<string, ColumnMeta> = {}
  for (const [key, v] of Object.entries(input).slice(0, MAX_ENTRIES)) {
    const clean = sanitizeColumnMeta(v)
    if (clean && key.length <= 128) out[key] = clean
  }
  return Object.keys(out).length ? out : undefined
}

/** The meta fields a table column carries itself (its label is the column's own `label`). */
function fieldsOf(meta: ColumnMeta | undefined): Omit<ColumnMeta, 'label'> {
  if (!meta) return {}
  const rest: ColumnMeta = { ...meta }
  delete rest.label
  return rest
}

/** A scalar's or the first series' meta from a query's declared `meta` (the key convention of `DataSourceQueryDef.meta`). */
export function queryMetaFor(shape: DataSourceResult['shape'], meta: DataSourceQueryDef['meta']): ColumnMeta | undefined {
  if (!meta) return undefined
  if (shape === 'scalar') return meta.value ?? Object.values(meta)[0]
  if (shape === 'series') return Object.values(meta)[0]
  return undefined
}

/**
 * The result with every piece of meta cleaned, and the query's declared meta filled in where the source
 * said nothing of its own (what the source says in its answer wins). Returns a new object when anything
 * changed; never mutates the input (it may be a cached object).
 */
export function finalizeResultMeta(result: DataSourceResult, declared?: DataSourceQueryDef['meta']): DataSourceResult {
  const decl = sanitizeRecord(declared)
  const out: DataSourceResult = { ...result }
  if (result.shape === 'scalar') {
    const own = sanitizeColumnMeta(result.meta)
    const meta = own ?? queryMetaFor('scalar', decl)
    if (meta) out.meta = meta
    else delete out.meta
  }
  if (result.shape === 'series' && result.series) {
    out.series = result.series.map((s) => {
      const meta = sanitizeColumnMeta(s.meta) ?? decl?.[s.name] ?? (result.series!.length === 1 ? queryMetaFor('series', decl) : undefined)
      return { name: s.name, points: s.points, ...(meta ? { meta } : {}) }
    })
  }
  if (result.shape === 'table' && result.columns) {
    out.columns = result.columns.map((c) => {
      const own = sanitizeColumnMeta({ ...c, label: undefined })
      return { key: c.key, label: c.label, type: c.type, ...fieldsOf(decl?.[c.key]), ...fieldsOf(own) }
    })
  }
  if (result.shape === 'record') {
    const meta = sanitizeRecord(result.recordMeta) ?? decl
    if (meta) out.recordMeta = meta
    else delete out.recordMeta
  }
  return out
}
