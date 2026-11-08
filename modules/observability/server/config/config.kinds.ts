/**
 * The vocabulary of the monitoring-as-code document (observability phase 21): which kinds of resource it carries, how a resource is
 * named across file and database, and which permissions each kind demands. Pure: the CLI imports this file.
 */

/** Every kind the document can carry, in the order they are APPLIED (a later kind may refer to an earlier one). Deletes run in reverse. */
export const CONFIG_KINDS = ['monitors', 'components', 'slos', 'silenceTemplates', 'integrations', 'routes', 'dependencies', 'incidentTemplates'] as const
export type ConfigKind = (typeof CONFIG_KINDS)[number]

export const CONFIG_KIND_LABEL: Record<ConfigKind, string> = {
  monitors: 'monitor', components: 'status component', slos: 'SLO', silenceTemplates: 'silence template', integrations: 'alert integration',
  routes: 'alert route', dependencies: 'alert dependency', incidentTemplates: 'incident update template',
}

/**
 * The permission the SAME action in the admin UI asks for, per kind. A config apply that touches a kind must hold exactly this
 * permission for that kind (reading needs the `read` twin); a request that names fewer kinds needs fewer permissions.
 *
 * Status components are written by the monitors permission in the UI (their routes ask `observability.monitors.*`), so config does too.
 *
 * One deliberate difference: reading monitors and components for an export or a plan asks for `observability.monitors.manage`, not
 * `observability.monitors.read`. That permission declares the MEMBER floor, which is not a role the guard knows (register S11): nobody can
 * hold it today, so reading through it would make the export unreachable, and the day it is repaired to USER every member could read
 * every monitor's definition (targets, step lists, header NAMES) through a document built for administrators. Stricter than the console,
 * on purpose, and never looser.
 */
export const CONFIG_PERMISSIONS: Record<ConfigKind, { read: string; manage: string }> = {
  monitors: { read: 'observability.monitors.manage', manage: 'observability.monitors.manage' },
  components: { read: 'observability.monitors.manage', manage: 'observability.monitors.manage' },
  slos: { read: 'observability.slos.read', manage: 'observability.slos.manage' },
  silenceTemplates: { read: 'observability.alerts.read', manage: 'observability.alerts.manage' },
  integrations: { read: 'observability.alerts.read', manage: 'observability.alerts.manage' },
  routes: { read: 'observability.alerts.read', manage: 'observability.alerts.manage' },
  dependencies: { read: 'observability.alerts.read', manage: 'observability.alerts.manage' },
  incidentTemplates: { read: 'observability.incidents.read', manage: 'observability.incidents.manage' },
}

/** The `api_key` scopes of the machine lane. `write` implies `read` (the api_key hierarchy); the coarse `read` / `write` verbs satisfy neither. */
export const CONFIG_SCOPE_READ = 'observability_config:read'
export const CONFIG_SCOPE_WRITE = 'observability_config:write'

/** `managedBy` value of a resource applied from a repository. Null means the UI (or an importer, or a provider) owns it. */
export const MANAGED_BY_CODE = 'code'

/** A stable name inside the document. Lowercase so two files cannot differ by case only; short enough for `sourceKey` (200). */
export const KEY_RE = /^[a-z0-9][a-z0-9._-]{0,99}$/
export const KEY_MESSAGE = 'a key is 1-100 characters: lowercase letters, digits, dot, underscore, hyphen; it starts with a letter or digit'

export const SOURCE_KEY_PREFIX = 'code:'
export const sourceKeyOf = (key: string): string => `${SOURCE_KEY_PREFIX}${key}`
export const keyOfSource = (sourceKey: string | null | undefined): string | null =>
  typeof sourceKey === 'string' && sourceKey.startsWith(SOURCE_KEY_PREFIX) ? sourceKey.slice(SOURCE_KEY_PREFIX.length) : null

/** A readable stable key from a display name; used by `export` and the importers (the caller dedupes). */
export function slugKey(name: string, fallback = 'item'): string {
  const s = name.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
  return s || fallback
}

/** `a`, `a-2`, `a-3` ...: unique within `taken` (which is updated). */
export function uniqueKey(base: string, taken: Set<string>): string {
  let key = base
  for (let n = 2; taken.has(key); n += 1) key = `${base}-${n}`
  taken.add(key)
  return key
}

/** Keys that must never appear as an object key anywhere in a document (prototype pollution). */
export const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
