import type { ObservabilityConfig } from '../config.dto'
import { validateConfig, issuesToProblems } from '../config.parse'
import { CONFIG_SCHEMA_ID } from '../config.dto'
import { exportEnvName } from '../config.export'
import { slugKey, uniqueKey } from '../config.kinds'

/**
 * Importers (observability phase 21.4). Every importer is a CONVERTER to `roltek-observability-1`: it reads the source tool's own export
 * and returns a document that has already passed the same validation as a hand-written file, plus a REPORT. Nothing is written by an importer;
 * the document goes through plan and apply like any other, so an import has exactly one write path.
 *
 * All or nothing: a malformed input, or a document that does not validate, returns no document at all (`document: null`) and the report says
 * why. An item that has no equivalent is not guessed at: it is left out and listed under `unmapped` with the reason, so the report is the
 * complete answer to "what did not come across".
 *
 * Secrets are never copied. A header value, a password or a push token in a source is replaced by a reference to an environment variable
 * (`OBS_<KEY>_HEADER_<NAME>`) the operator must provide, and the report lists the variables. A heartbeat token is issued fresh by the apply.
 */
export interface MappedItem { kind: string; key: string; from: string; notes?: string[] }
export interface UnmappedItem { item: string; reason: string }
export interface ImportReport {
  source: string
  /** How the source format was checked, in one line (see the phase document for the long version). */
  format: string
  mapped: MappedItem[]
  unmapped: UnmappedItem[]
  warnings: string[]
  /** Blocking: the input is malformed or the result does not validate. */
  errors: string[]
  /** Environment variables the operator must provide before an apply (never their values). */
  secretsNeeded: string[]
}
export interface ImportResult { document: ObservabilityConfig | null; report: ImportReport }

export interface Importer {
  id: string
  title: string
  /** Input formats the importer reads. */
  accepts: Array<'json' | 'csv' | 'yaml'>
  /** What the converter cannot carry over, stated up front (also printed by `--help`). */
  cannotMap: string[]
  run(text: string, opts?: { format?: 'json' | 'csv' | 'yaml' }): ImportResult
}

export function newReport(source: string, format: string): ImportReport {
  return { source, format, mapped: [], unmapped: [], warnings: [], errors: [], secretsNeeded: [] }
}

export const blank = (): Omit<ObservabilityConfig, 'schema'> => ({
  monitors: [], components: [], slos: [], silenceTemplates: [], integrations: [], routes: [], dependencies: [], incidentTemplates: [],
})

/** Validate what a converter built, with the same rules as a file; a failure is a blocking error naming the path, never a partial document. */
export function finish(report: ImportReport, draft: Record<string, unknown>): ImportResult {
  if (report.errors.length > 0) return { document: null, report }
  // A JSON round trip drops `undefined` fields, so a converter may leave a field unset.
  const r = validateConfig(JSON.parse(JSON.stringify({ schema: CONFIG_SCHEMA_ID, ...draft })))
  if (!r.ok) {
    for (const p of r.problems) report.errors.push(`the converted document is not valid: ${p.path}: ${p.message}`)
    return { document: null, report }
  }
  if (r.document.monitors.length + r.document.components.length + r.document.routes.length + r.document.integrations.length === 0) {
    report.errors.push('nothing could be imported from this input')
    return { document: null, report }
  }
  return { document: r.document, report }
}

/** A header whose VALUE is never copied: a reference to the environment variable the operator provides. Records the variable in the report. */
export function secretHeader(report: ImportReport, key: string, name: string): { fromEnv: string } {
  const env = exportEnvName(key, 'HEADER', name)
  if (!report.secretsNeeded.includes(env)) report.secretsNeeded.push(env)
  return { fromEnv: env }
}

export class KeyAllocator {
  private taken = new Set<string>()
  next(name: string, fallback: string): string { return uniqueKey(slugKey(name, fallback), this.taken) }
}

export { issuesToProblems }

/** Parse JSON defensively for an importer: a bounded, plain-data result or an error string. */
export function parseJson(text: string): { value: unknown } | { error: string } {
  if (Buffer.byteLength(text, 'utf8') > 5_000_000) return { error: 'the input is larger than 5 MB' }
  try {
    const value = JSON.parse(text)
    return { value }
  } catch { return { error: 'the input is not valid JSON' } }
}

export const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
export const num = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
