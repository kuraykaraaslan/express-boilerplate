import YAML from 'yaml'
import { CreateMonitorDTO, type CreateMonitorInput } from './uptime.dto'

/**
 * Bulk monitor import (observability phase 09.7): CSV, YAML or JSON in, validated monitors out.
 *
 * Pure. A dry run is the default at the route: this module only parses and validates, so the report is identical whether or not
 * anything is written afterwards. Every row passes the same `CreateMonitorDTO` as a hand-made monitor, so an import is never a way
 * round a rule.
 */

export const MAX_IMPORT_ROWS = 200

export interface ImportReport {
  /** Rows that passed validation, ready to create. */
  valid: CreateMonitorInput[]
  /** Rows that did not, with the 1-based row number and a short reason. Nothing is written when any exist unless the caller opts in. */
  errors: { row: number; message: string }[]
}

/** Minimal RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF. No dependency, bounded by the caller's size limit. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1 } else quoted = false } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1
      row.push(field); field = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

const NUMERIC = new Set(['quorum', 'intervalSeconds', 'timeoutMs', 'expectedStatus', 'degradedLatencyMs', 'consecutiveFailThreshold', 'certWarnDays', 'certCriticalDays', 'heartbeatGraceSeconds'])

/** CSV header names are the DTO field names (case-insensitive), plus `group` for `groupName` and `url` for `target`. `tags` is `;`-separated. */
export function csvToObjects(rows: string[][]): Record<string, unknown>[] {
  if (rows.length < 2) return []
  const alias: Record<string, string> = { group: 'groupName', url: 'target', interval: 'intervalSeconds', timeout: 'timeoutMs' }
  const header = rows[0].map((h) => {
    const k = h.trim()
    const lower = k.toLowerCase()
    return alias[lower] ?? Object.keys(CreateMonitorDTO.shape).find((f) => f.toLowerCase() === lower) ?? k
  })
  return rows.slice(1).map((r) => {
    const o: Record<string, unknown> = {}
    header.forEach((key, i) => {
      const raw = (r[i] ?? '').trim()
      if (raw === '') return
      if (NUMERIC.has(key)) o[key] = Number(raw)
      else if (key === 'tags' || key === 'locations') o[key] = raw.split(';').map((t) => t.trim()).filter(Boolean)
      else if (key === 'isActive') o[key] = raw.toLowerCase() !== 'false'
      else o[key] = raw
    })
    return o
  })
}

function parseObjects(format: 'csv' | 'yaml' | 'json', content: string): Record<string, unknown>[] | { error: string } {
  try {
    if (format === 'csv') return csvToObjects(parseCsv(content))
    // maxAliasCount keeps a YAML alias bomb from expanding into memory.
    const doc = format === 'yaml' ? YAML.parse(content, { maxAliasCount: 10 }) : JSON.parse(content)
    const list = Array.isArray(doc) ? doc : (doc as { monitors?: unknown })?.monitors
    if (!Array.isArray(list)) return { error: 'expected a list of monitors (or an object with a `monitors` list)' }
    return list as Record<string, unknown>[]
  } catch (err) {
    return { error: `could not parse ${format}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}` }
  }
}

export function parseMonitorImport(format: 'csv' | 'yaml' | 'json', content: string): ImportReport {
  const parsed = parseObjects(format, content)
  if ('error' in parsed) return { valid: [], errors: [{ row: 0, message: parsed.error }] }
  if (parsed.length === 0) return { valid: [], errors: [{ row: 0, message: 'no monitors found' }] }
  if (parsed.length > MAX_IMPORT_ROWS) return { valid: [], errors: [{ row: 0, message: `at most ${MAX_IMPORT_ROWS} monitors per import` }] }

  const report: ImportReport = { valid: [], errors: [] }
  parsed.forEach((raw, i) => {
    const r = CreateMonitorDTO.safeParse(raw)
    if (r.success) report.valid.push(r.data)
    else {
      const issue = r.error.issues[0]
      report.errors.push({ row: i + 1, message: `${issue.path.join('.') || 'row'}: ${issue.message}`.slice(0, 200) })
    }
  })
  return report
}
