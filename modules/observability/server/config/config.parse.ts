import YAML from 'yaml'
import type { z } from 'zod'
import { wouldCycle } from '../alert.inhibit'
import { ObservabilityConfigDTO, MAX_CONFIG_BYTES, KIND_FIELD, type ObservabilityConfig, type SecretValue } from './config.dto'
import { CONFIG_KINDS, FORBIDDEN_KEYS, type ConfigKind } from './config.kinds'

/**
 * Reading a monitoring-as-code document (observability phase 21). The file is untrusted input (a pull request, a pasted blob, a
 * downloaded export) so it is bounded, parsed without anything executable, refused when it carries a key that pollutes prototypes, and
 * validated by the same DTOs the API uses. Nothing here touches the network or the disk: the CLI and the server both call it.
 */

export interface ConfigProblem { path: string; message: string }

export class ConfigParseError extends Error {
  constructor(message: string, readonly problems: ConfigProblem[] = [{ path: '', message }]) { super(message); this.name = 'ConfigParseError' }
}

const MAX_DEPTH = 24
const MAX_NODES = 60_000
/** YAML anchors are allowed (a team may share a `defaults` block) but their expansion is capped: an alias bomb is refused, not expanded. */
const MAX_ALIAS_COUNT = 10

/** Walks a parsed value once: JSON types only, no prototype-polluting key, bounded depth and size. Throws a `ConfigParseError`. */
export function scanHostile(value: unknown): void {
  let nodes = 0
  const walk = (v: unknown, depth: number, path: string): void => {
    nodes += 1
    if (nodes > MAX_NODES) throw new ConfigParseError('the document is too large (too many values)')
    if (depth > MAX_DEPTH) throw new ConfigParseError(`the document is nested too deeply${path ? ` (at ${path})` : ''}`)
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new ConfigParseError(`a number is not finite${path ? ` (at ${path})` : ''}`); return }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, depth + 1, `${path}[${i}]`)); return }
    if (typeof v === 'object') {
      const proto = Object.getPrototypeOf(v)
      if (proto !== Object.prototype && proto !== null) throw new ConfigParseError(`only plain data is allowed${path ? ` (at ${path})` : ''}`)
      for (const k of Object.keys(v as object)) {
        if (FORBIDDEN_KEYS.has(k)) throw new ConfigParseError(`the key "${k}" is not allowed${path ? ` (under ${path})` : ''}`)
        walk((v as Record<string, unknown>)[k], depth + 1, path ? `${path}.${k}` : k)
      }
      return
    }
    throw new ConfigParseError(`only plain data is allowed${path ? ` (at ${path})` : ''}`)
  }
  walk(value, 0, '')
}

/** Text to a plain value, bounded and scanned. YAML is the 1.2 core schema: no custom tags, no merge keys, one document, bounded aliases. */
export function parseConfigText(text: string, format: 'yaml' | 'json'): unknown {
  if (typeof text !== 'string') throw new ConfigParseError('the document is not text')
  if (Buffer.byteLength(text, 'utf8') > MAX_CONFIG_BYTES) throw new ConfigParseError(`the document is larger than ${MAX_CONFIG_BYTES} bytes`)
  let value: unknown
  try {
    if (format === 'json') value = JSON.parse(text)
    else {
      const docs = YAML.parseAllDocuments(text, { merge: false, uniqueKeys: true, schema: 'core' })
      const list = Array.isArray(docs) ? docs : [docs]
      if (list.length !== 1) throw new ConfigParseError('exactly one YAML document is allowed')
      const doc = list[0]
      if (doc.errors.length > 0) throw new ConfigParseError(`could not parse yaml: ${doc.errors[0].message.split('\n')[0]}`.slice(0, 200))
      value = doc.toJS({ maxAliasCount: MAX_ALIAS_COUNT })
    }
  } catch (err) {
    if (err instanceof ConfigParseError) throw err
    // The parser's own message can quote the offending text; keep only the position-free first line, bounded.
    throw new ConfigParseError(`could not parse ${format}: ${(err instanceof Error ? err.message : String(err)).split('\n')[0].replace(/["'`].*$/, '').trim().slice(0, 120)}`)
  }
  scanHostile(value)
  return value
}

/** zod issues as `path: message`. A zod message names the expectation, never the received value, so a secret in a bad field is not echoed. */
export function issuesToProblems(issues: ReadonlyArray<z.core.$ZodIssue>): ConfigProblem[] {
  return issues.slice(0, 50).map((i) => {
    let path = ''
    for (const p of i.path) path += typeof p === 'number' ? `[${p}]` : path ? `.${String(p)}` : String(p)
    const message = i.code === 'unrecognized_keys' ? `unknown field(s): ${(i as { keys: string[] }).keys.join(', ')}` : i.message
    return { path, message: message.slice(0, 240) }
  })
}

export interface ExternalRefs { monitors: ReadonlySet<string>; components: ReadonlySet<string> }

const edgeEnd = (ref: string): { kind: 'component' | 'monitor' | 'other'; key: string } => {
  const m = /^(component|monitor):(.+)$/.exec(ref)
  return m ? { kind: m[1] as 'component' | 'monitor', key: m[2] } : { kind: 'other', key: ref }
}

/** Rules that span the document: unique keys, resolvable references, a dependency graph without loops. `external` are code-managed keys that exist live. */
export function checkDocument(doc: ObservabilityConfig, external: ExternalRefs = { monitors: new Set(), components: new Set() }): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  const add = (path: string, message: string) => problems.push({ path, message })

  const defined: Record<'monitors' | 'components', Set<string>> = { monitors: new Set(), components: new Set() }
  for (const kind of ['monitors', 'components', 'slos', 'silenceTemplates', 'integrations', 'routes'] as const) {
    const seen = new Map<string, number>()
    doc[kind].forEach((item, i) => {
      const first = seen.get(item.key)
      if (first !== undefined) add(`${kind}[${i}].key`, `duplicate key "${item.key}" (also ${kind}[${first}])`)
      else seen.set(item.key, i)
      if (kind === 'monitors' || kind === 'components') defined[kind].add(item.key)
    })
  }
  const monitorKnown = (k: string) => defined.monitors.has(k) || external.monitors.has(k)
  const componentKnown = (k: string) => defined.components.has(k) || external.components.has(k)

  doc.components.forEach((c, i) => c.monitors.forEach((m, j) => { if (!monitorKnown(m)) add(`components[${i}].monitors[${j}]`, `unknown monitor key "${m}"`) }))
  doc.slos.forEach((s, i) => {
    s.monitors.forEach((m, j) => { if (!monitorKnown(m)) add(`slos[${i}].monitors[${j}]`, `unknown monitor key "${m}"`) })
    if (s.component && !componentKnown(s.component)) add(`slos[${i}].component`, `unknown component key "${s.component}"`)
  })

  const seenTemplates = new Set<string>()
  doc.incidentTemplates.forEach((t, i) => {
    const id = `${t.status}/${t.locale}`
    if (seenTemplates.has(id)) add(`incidentTemplates[${i}]`, `duplicate template for ${t.status} in ${t.locale}`)
    seenTemplates.add(id)
  })

  const edges: Array<{ child: string; parent: string }> = []
  doc.dependencies.forEach((d, i) => {
    for (const side of ['child', 'parent'] as const) {
      const end = edgeEnd(d[side])
      if (end.kind === 'monitor' && !monitorKnown(end.key)) add(`dependencies[${i}].${side}`, `unknown monitor key "${end.key}"`)
      if (end.kind === 'component' && !componentKnown(end.key)) add(`dependencies[${i}].${side}`, `unknown component key "${end.key}"`)
    }
    if (d.child === d.parent) { add(`dependencies[${i}]`, 'an entity cannot depend on itself'); return }
    if (edges.some((e) => e.child === d.child && e.parent === d.parent)) { add(`dependencies[${i}]`, 'duplicate dependency'); return }
    if (wouldCycle(edges, d.child, d.parent)) { add(`dependencies[${i}]`, 'this dependency would create a loop'); return }
    edges.push({ child: d.child, parent: d.parent })
  })
  return problems
}

export type ValidateResult = { ok: true; document: ObservabilityConfig } | { ok: false; problems: ConfigProblem[] }

/** A plain value to a validated document (DTOs, then the document-level rules). */
export function validateConfig(raw: unknown, external?: ExternalRefs): ValidateResult {
  try { scanHostile(raw) } catch (e) { return { ok: false, problems: (e as ConfigParseError).problems } }
  const parsed = ObservabilityConfigDTO.safeParse(raw)
  if (!parsed.success) return { ok: false, problems: issuesToProblems(parsed.error.issues) }
  const problems = checkDocument(parsed.data, external)
  return problems.length ? { ok: false, problems } : { ok: true, document: parsed.data }
}

/** Text to a validated document in one step. */
export function readConfigText(text: string, format: 'yaml' | 'json', external?: ExternalRefs): ValidateResult {
  try { return validateConfig(parseConfigText(text, format), external) } catch (e) {
    if (e instanceof ConfigParseError) return { ok: false, problems: e.problems }
    throw e
  }
}

/** Several files are one document: lists are concatenated (a duplicate key is then a normal duplicate-key problem). */
export function mergeRawConfigs(raws: unknown[]): unknown {
  const out: Record<string, unknown> = {}
  for (const raw of raws) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigParseError('a configuration file must be an object')
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k === 'schema') { if ('schema' in out && out.schema !== v) throw new ConfigParseError('the files declare different schemas'); out.schema = v; continue }
      if (Array.isArray(v) && (CONFIG_KINDS as readonly string[]).includes(k)) out[k] = [...((out[k] as unknown[]) ?? []), ...v]
      else out[k] = v
    }
  }
  return out
}

// ── secrets ─────────────────────────────────────────────────────────────────

export interface SecretLocation { path: string; value: SecretValue }

/** Every secret-valued field of the document (header values and step secrets), with its path. */
export function secretLocations(doc: ObservabilityConfig): SecretLocation[] {
  const out: SecretLocation[] = []
  doc.monitors.forEach((m, i) => {
    for (const [name, v] of Object.entries(m.headers ?? {})) out.push({ path: `monitors[${i}].headers.${name}`, value: v })
    for (const [name, v] of Object.entries(m.secrets ?? {})) out.push({ path: `monitors[${i}].secrets.${name}`, value: v })
  })
  return out
}

export const isSecretRef = (v: SecretValue): v is Exclude<SecretValue, string> => typeof v !== 'string'

export interface SecretSource {
  env(name: string): string | undefined
  file(path: string): string | undefined
}

/**
 * Replace every `{ fromEnv }` and `{ fromFile }` with its value. A reference that cannot be read is a problem naming the variable or the file,
 * never a value. Returns the secret values it resolved so a caller can scrub them from anything it prints.
 */
export function resolveSecrets(doc: ObservabilityConfig, source: SecretSource): { document: ObservabilityConfig; problems: ConfigProblem[]; values: string[] } {
  const problems: ConfigProblem[] = []
  const values: string[] = []
  const pick = (path: string, v: SecretValue): string => {
    if (typeof v === 'string') { values.push(v); return v }
    let r: string | undefined
    if ('fromEnv' in v) {
      r = source.env(v.fromEnv)
      if (r === undefined || r === '') { problems.push({ path, message: `environment variable ${v.fromEnv} is not set` }); return '' }
    } else {
      try { r = source.file(v.fromFile) } catch { r = undefined }
      if (r === undefined || r === '') { problems.push({ path, message: `file ${v.fromFile} is missing, empty or unreadable` }); return '' }
    }
    // A trailing newline is how files end, not part of the secret.
    const value = r.replace(/\r?\n$/, '')
    if (value.length > 2000) { problems.push({ path, message: 'the secret is longer than 2000 characters' }); return '' }
    values.push(value)
    return value
  }
  const document: ObservabilityConfig = {
    ...doc,
    monitors: doc.monitors.map((m, i) => ({
      ...m,
      headers: m.headers ? Object.fromEntries(Object.entries(m.headers).map(([k, v]) => [k, pick(`monitors[${i}].headers.${k}`, v)])) : m.headers,
      secrets: m.secrets ? Object.fromEntries(Object.entries(m.secrets).map(([k, v]) => [k, pick(`monitors[${i}].secrets.${k}`, v)])) : m.secrets,
    })),
  }
  return { document, problems, values: [...new Set(values.filter((v) => v.length > 0))] }
}

/** The server never resolves references (it has no business reading its own environment on a caller's say-so): a document that still has one is refused. */
export function unresolvedSecrets(doc: ObservabilityConfig): ConfigProblem[] {
  return secretLocations(doc).filter((l) => isSecretRef(l.value)).map((l) => ({ path: l.path, message: 'a secret reference (fromEnv / fromFile) must be resolved by the CLI before it is sent' }))
}

/** Replace each of `values` in `text` with a marker. Defence in depth for anything printed: the CLI never prints a secret on purpose, and this catches the accidents. */
export function redact(text: string, values: readonly string[]): string {
  let out = text
  for (const v of [...values].sort((a, b) => b.length - a.length)) if (v.length >= 3) out = out.split(v).join('[redacted]')
  return out
}

export { KIND_FIELD }
export type { ConfigKind }
