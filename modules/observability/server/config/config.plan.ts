import { createHash } from 'node:crypto'
import { decryptFieldOpt } from '@kuraykaraaslan-labs/common/server/field-encryption'
import type { ObservabilityConfig } from './config.dto'
import { CONFIG_KINDS, CONFIG_KIND_LABEL, MANAGED_BY_CODE, keyOfSource, type ConfigKind } from './config.kinds'
import type { ConfigProblem } from './config.parse'
import { browserStartUrl } from '../uptime.browser.schema'

/**
 * The plan of a monitoring-as-code apply (observability phase 21.3): what a document would change, computed from the document and a
 * snapshot of the live rows and nothing else. Pure, so `diff`, `plan`, `apply` and the console all answer from one function and a test
 * can drive it without a database.
 *
 * Identity. A resource of a keyed kind (monitor, component, SLO, silence template, integration, route) is the live row marked
 * `managedBy = 'code'` whose `sourceKey` is `code:<key>`. A dependency is its (child, parent) pair and an update template is its
 * (status, locale); those two already have a natural key, so they are only marked. A resource that exists in the console and is not marked
 * belongs to the console: it is never touched, never deleted, and reported only when its name collides with something the file creates.
 *
 * Drift. The comparison is field by field between the file and the live row (`defOfRow`): a hand-edited field is an `update`, a managed
 * row the file no longer mentions is an `orphan` (an explicit `prune` turns it into a `delete`). Header values and step secrets are compared
 * server-side and reported by NAME only, never by value.
 */

type Row = Record<string, unknown>

export interface LiveSnapshot {
  monitors?: Row[]
  /** Each component row carries `monitorIds`. */
  components?: Row[]
  slos?: Row[]
  silenceTemplates?: Row[]
  integrations?: Row[]
  routes?: Row[]
  dependencies?: Row[]
  incidentTemplates?: Row[]
}

export type PlanOp = 'create' | 'update' | 'adopt' | 'delete' | 'orphan' | 'noop'

export interface PlanAction {
  kind: ConfigKind
  /** The key in the file (monitors ... routes), `child>parent` (dependencies) or `STATUS/locale` (incident templates). */
  key: string
  op: PlanOp
  /** The live row's id (update, adopt, delete, orphan, noop). */
  id?: string
  /** Names of the fields that differ. Never values. */
  fields?: string[]
  /** Header / secret names that differ (values are never reported). */
  secretFields?: string[]
}

export interface Plan {
  actions: PlanAction[]
  problems: ConfigProblem[]
  warnings: string[]
  summary: Record<PlanOp, number>
  /** True when the live state differs from the file in any way (anything but `noop`). `diff` exits non-zero on it. */
  drift: boolean
  /** A digest of the changes: `apply` can refuse to run when it is no longer what the caller reviewed. */
  hash: string
}

export interface PlanOptions { kinds?: readonly ConfigKind[]; prune?: boolean; adopt?: boolean; /** Identities to delete when absent from the document (a keyed prune). */ pruneKeys?: readonly string[] }

// ── canonical comparison ────────────────────────────────────────────────────

/** Sorted keys; null, undefined, empty arrays and empty objects dropped, so "absent", null and empty are one thing on both sides. */
export function canon(v: unknown): unknown {
  if (Array.isArray(v)) { const a = v.map(canon).filter((x) => x !== undefined); return a.length ? a : undefined }
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o: Row = {}
    for (const k of Object.keys(v as Row).sort()) { const c = canon((v as Row)[k]); if (c !== undefined) o[k] = c }
    return Object.keys(o).length ? o : undefined
  }
  if (v instanceof Date) return v.toISOString()
  return v === null ? undefined : v
}
const same = (a: unknown, b: unknown) => JSON.stringify(canon(a) ?? null) === JSON.stringify(canon(b) ?? null)

function changed(want: Row, have: Row): string[] {
  const out: string[] = []
  for (const k of new Set([...Object.keys(want), ...Object.keys(have)])) if (!same(want[k], have[k])) out.push(k)
  return out.sort()
}

const sorted = (v: unknown): string[] => (Array.isArray(v) ? [...(v as string[])].sort() : [])
const pick = (o: Row, fields: readonly string[]): Row => Object.fromEntries(fields.map((f) => [f, o[f]]))

// ── what is compared, per kind ──────────────────────────────────────────────

const MONITOR_FIELDS = ['name', 'type', 'target', 'intervalSeconds', 'timeoutMs', 'expectedStatus', 'expectedBodyContains', 'degradedLatencyMs', 'consecutiveFailThreshold', 'isActive', 'assertions', 'certWarnDays', 'certCriticalDays', 'heartbeatGraceSeconds', 'steps', 'browser', 'latencyBaselineFactor', 'groupName', 'tags'] as const
/** A BROWSER monitor runs only from named probe locations, so for that type (and no other: existing monitors' locations stay UI-owned) they are part of the definition. */
const BROWSER_ONLY_FIELDS = ['locations', 'quorum'] as const
const monitorDef = (r: Row): Row => ({ ...pick(r, MONITOR_FIELDS), ...(r.type === 'BROWSER' ? pick(r, BROWSER_ONLY_FIELDS) : {}), target: monitorTarget(r.type, r.target, r.browser) })
const ROUTE_FIELDS = ['name', 'matchers', 'groupBy', 'groupWaitSeconds', 'groupIntervalSeconds', 'targets', 'incident', 'continueMatching', 'enabled'] as const
const SLO_FIELDS = ['name', 'description', 'kind', 'objectivePercent', 'windowDays', 'latencyThresholdMs', 'metricSpec', 'lowBudgetPercent', 'burnAlerts', 'isActive'] as const

/** A HEARTBEAT and a STEPS monitor have no target of their own; the row keeps a placeholder, which is not part of the definition. */
function monitorTarget(type: unknown, target: unknown, browser?: unknown): unknown {
  if ((type === 'HEARTBEAT' && (target === 'heartbeat' || target == null)) || (type === 'STEPS' && (target === 'steps' || target == null))) return undefined
  // A BROWSER monitor's row target is its first goto URL (derived), so it is not part of the definition either.
  if (type === 'BROWSER' && (target == null || target === browserStartUrl(browser))) return undefined
  return target
}

export interface Maps {
  monitorKeyById: Map<string, string>
  componentKeyById: Map<string, string>
}

export function buildMaps(snap: LiveSnapshot): Maps {
  const keys = (rows: Row[] | undefined, idField: string) => new Map((rows ?? []).flatMap((r) => {
    const k = r.managedBy === MANAGED_BY_CODE ? keyOfSource(r.sourceKey as string | null) : null
    return k ? [[r[idField] as string, k] as [string, string]] : []
  }))
  return { monitorKeyById: keys(snap.monitors, 'monitorId'), componentKeyById: keys(snap.components, 'componentId') }
}

const monitorRef = (id: string, maps: Maps) => maps.monitorKeyById.get(id) ?? `#${id}`

interface Entry {
  /** Identity inside the kind. Null for an unmanaged row of a keyed kind. */
  ident: string | null
  id: string
  managed: boolean
  name: string | null
  /** May be taken over by `adopt` (a provider-managed monitor may not). */
  adoptable: boolean
  def: Row
  row: Row
}

interface Wanted { ident: string; name: string | null; def: Row; index: number }

const isManaged = (r: Row) => r.managedBy === MANAGED_BY_CODE

function entityRef(ref: string, maps: Maps, toKey: boolean): string {
  const m = /^(component|monitor):(.+)$/.exec(ref)
  if (!m) return ref
  if (!toKey) return ref
  const key = (m[1] === 'component' ? maps.componentKeyById : maps.monitorKeyById).get(m[2])
  return `${m[1]}:${key ?? `#${m[2]}`}`
}

function liveEntries(kind: ConfigKind, snap: LiveSnapshot, maps: Maps): Entry[] {
  const keyed = (rows: Row[] | undefined, idField: string, def: (r: Row) => Row): Entry[] => (rows ?? []).map((r) => ({
    ident: isManaged(r) ? keyOfSource(r.sourceKey as string | null) : null,
    id: r[idField] as string, managed: isManaged(r), name: (r.name as string) ?? null,
    adoptable: !r.sourceKey || isManaged(r), def: def(r), row: r,
  }))
  switch (kind) {
    case 'monitors':
      return keyed(snap.monitors, 'monitorId', (r) => monitorDef(r))
    case 'components':
      return keyed(snap.components, 'componentId', (r) => ({
        name: r.name, description: r.description, order: r.order, isPublic: r.isPublic,
        monitors: sorted(((r.monitorIds as string[]) ?? []).map((id) => monitorRef(id, maps))),
      }))
    case 'slos':
      return keyed(snap.slos, 'sloId', (r) => ({
        ...pick(r, SLO_FIELDS),
        monitors: sorted(((r.monitorIds as string[]) ?? []).map((id) => monitorRef(id, maps))),
        component: r.componentId ? (maps.componentKeyById.get(r.componentId as string) ?? `#${r.componentId}`) : null,
      }))
    case 'silenceTemplates':
      return keyed(snap.silenceTemplates, 'templateId', (r) => pick(r, ['name', 'matchers', 'durationMinutes', 'reason']))
    case 'integrations':
      return keyed(snap.integrations, 'integrationId', (r) => pick(r, ['name', 'kind', 'severityCeiling', 'defaultLabels', 'enabled']))
    case 'routes':
      return keyed(snap.routes, 'routeId', (r) => ({ ...pick(r, ROUTE_FIELDS), position: r.position }))
    case 'dependencies':
      return (snap.dependencies ?? []).map((r) => ({
        ident: `${entityRef(r.child as string, maps, true)}>${entityRef(r.parent as string, maps, true)}`,
        id: r.dependencyId as string, managed: isManaged(r), name: null, adoptable: true, def: {}, row: r,
      }))
    case 'incidentTemplates':
      return (snap.incidentTemplates ?? []).map((r) => ({
        ident: `${r.status}/${r.locale}`, id: r.templateId as string, managed: isManaged(r), name: null, adoptable: true, def: { body: r.body }, row: r,
      }))
  }
}

function wantedItems(kind: ConfigKind, doc: ObservabilityConfig): Wanted[] {
  switch (kind) {
    case 'monitors':
      return doc.monitors.map((m, index) => ({ ident: m.key, name: m.name, index, def: monitorDef(m as unknown as Row) }))
    case 'components':
      return doc.components.map((c, index) => ({
        ident: c.key, name: c.name, index,
        def: { name: c.name, description: c.description, order: c.order ?? index, isPublic: c.isPublic ?? true, monitors: sorted(c.monitors) },
      }))
    case 'slos':
      return doc.slos.map((s, index) => ({ ident: s.key, name: s.name, index, def: { ...pick(s as unknown as Row, SLO_FIELDS), monitors: sorted(s.monitors), component: s.component ?? null } }))
    case 'silenceTemplates':
      return doc.silenceTemplates.map((t, index) => ({ ident: t.key, name: t.name, index, def: pick(t as unknown as Row, ['name', 'matchers', 'durationMinutes', 'reason']) }))
    case 'integrations':
      return doc.integrations.map((i, index) => ({ ident: i.key, name: i.name, index, def: pick(i as unknown as Row, ['name', 'kind', 'severityCeiling', 'defaultLabels', 'enabled']) }))
    case 'routes':
      return doc.routes.map((r, index) => ({ ident: r.key, name: r.name, index, def: { ...pick(r as unknown as Row, ROUTE_FIELDS), position: r.position ?? index } }))
    case 'dependencies':
      return doc.dependencies.map((d, index) => ({ ident: `${d.child}>${d.parent}`, name: null, index, def: {} }))
    case 'incidentTemplates':
      return doc.incidentTemplates.map((t, index) => ({ ident: `${t.status}/${t.locale}`, name: null, index, def: { body: t.body } }))
  }
}

/** Header values and step secrets, compared with the stored ones server-side. Reports the NAMES that differ and never a value. */
function secretDiff(item: ObservabilityConfig['monitors'][number], row: Row): string[] {
  const out: string[] = []
  const wantHeaders = (item.headers ?? {}) as Record<string, string>
  const haveHeaders = (row.headers ?? {}) as Record<string, string>
  for (const n of new Set([...Object.keys(wantHeaders), ...Object.keys(haveHeaders)])) if (wantHeaders[n] !== haveHeaders[n]) out.push(`headers.${n}`)
  const wantSecrets = (item.secrets ?? {}) as Record<string, string>
  const haveSecrets = (row.secrets ?? {}) as Record<string, string>
  for (const n of new Set([...Object.keys(wantSecrets), ...Object.keys(haveSecrets)])) {
    const have = haveSecrets[n] === undefined ? undefined : decryptFieldOpt(haveSecrets[n])
    if (wantSecrets[n] !== have) out.push(`secrets.${n}`)
  }
  return out.sort()
}

const emptySummary = (): Record<PlanOp, number> => ({ create: 0, update: 0, adopt: 0, delete: 0, orphan: 0, noop: 0 })

/** Compute the plan. `doc` is validated and its secrets resolved; `snap` holds the live rows of at least the kinds planned and the monitors and components their references need. */
export function planConfig(doc: ObservabilityConfig, snap: LiveSnapshot, opts: PlanOptions = {}): Plan {
  const kinds = CONFIG_KINDS.filter((k) => !opts.kinds || opts.kinds.includes(k))
  const maps = buildMaps(snap)
  const actions: PlanAction[] = []
  const problems: ConfigProblem[] = []
  const warnings: string[] = []
  const pruneKeys = new Set(opts.pruneKeys ?? [])

  for (const kind of kinds) {
    const label = CONFIG_KIND_LABEL[kind]
    const live = liveEntries(kind, snap, maps)
    const wanted = wantedItems(kind, doc)
    const managedByIdent = new Map(live.filter((e) => e.managed && e.ident).map((e) => [e.ident as string, e]))
    const natural = kind === 'dependencies' || kind === 'incidentTemplates'
    const claimed = new Set<string>()

    for (const w of wanted) {
      const where = `${kind}[${w.index}]`
      const item = (doc[kind] as unknown as Array<Record<string, unknown>>)[w.index]
      const hit = managedByIdent.get(w.ident)
      let target: Entry | undefined = hit
      let adopting = false
      if (!hit) {
        // Not managed yet. A console row with the same natural identity (or, for keyed kinds, the same name) is a candidate to take over.
        const cands = live.filter((e) => !e.managed && !claimed.has(e.id) && e.adoptable && (natural ? e.ident === w.ident : w.name !== null && e.name === w.name))
        if (cands.length > 0 && !opts.adopt) {
          if (natural) { problems.push({ path: where, message: `a ${label} with this identity already exists in the console; pass adopt to take it over` }); continue }
          warnings.push(`${where}: ${cands.length} ${label}(s) named "${w.name}" exist in the console and stay as they are; this one is created next to them (pass adopt to take one over instead)`)
        } else if (cands.length > 0) {
          // Several console resources share the name: the one that already matches the file field for field is the one meant (this is what an
          // export produces, so exporting a console and applying it with adopt always pairs the right rows). Anything less exact is a guess.
          const exact = cands.length > 1 ? cands.filter((c) => changed(w.def, c.def).length === 0) : cands
          if (exact.length === 0) {
            problems.push({ path: where, message: `${cands.length} console ${label}s are named "${w.name}" and none of them matches this entry exactly: cannot tell which to adopt` })
            continue
          }
          target = exact[0]; adopting = true
        }
      }
      if (!target) { actions.push({ kind, key: w.ident, op: 'create' }); continue }
      claimed.add(target.id)

      let fields = changed(w.def, target.def)
      let secretFields: string[] = []
      if (kind === 'monitors') secretFields = secretDiff(item as never, target.row)
      if (kind === 'integrations' && fields.includes('kind') && target.def.kind !== undefined) {
        problems.push({ path: `${where}.kind`, message: 'the kind of an integration is fixed when it is created: use a new key (and remove the old one) to change it' })
        continue
      }
      // The position of a route is its order in the file; a console route interleaved among them is a reason to manage all of them.
      if (kind === 'routes') fields = fields.filter((f) => f !== 'position' || !same(w.def.position, target.def.position))
      const op: PlanOp = adopting ? 'adopt' : fields.length || secretFields.length ? 'update' : 'noop'
      actions.push({ kind, key: w.ident, op, id: target.id, ...(fields.length ? { fields } : {}), ...(secretFields.length ? { secretFields } : {}) })
      // A row being adopted is known by its key from here on, so the kinds that refer to it (links, SLOs, dependencies) compare by key.
      if (adopting && kind === 'monitors') maps.monitorKeyById.set(target.id, w.ident)
      if (adopting && kind === 'components') maps.componentKeyById.set(target.id, w.ident)
    }

    for (const e of live) {
      if (!e.managed || claimed.has(e.id)) continue
      if (e.ident && wanted.some((w) => w.ident === e.ident)) continue
      const remove = opts.prune === true || (e.ident !== null && pruneKeys.has(e.ident))
      actions.push({ kind, key: e.ident ?? `(unnamed ${e.id})`, op: remove ? 'delete' : 'orphan', id: e.id })
      if (!remove) warnings.push(`${kind}: "${e.ident ?? e.id}" is managed from code but is not in the file; it is left alone (pass prune to delete it)`)
    }
  }

  const summary = emptySummary()
  for (const a of actions) summary[a.op] += 1
  const material = actions.filter((a) => a.op !== 'noop').map((a) => ({ kind: a.kind, key: a.key, op: a.op, id: a.id ?? null, fields: a.fields ?? [], secretFields: a.secretFields ?? [] }))
  const hash = createHash('sha256').update(JSON.stringify(material)).digest('hex')
  return { actions, problems, warnings, summary, drift: material.length > 0, hash }
}

/** Order for execution: creates and updates in kind order (what a later kind refers to exists first), deletes in reverse. */
export function executionOrder(plan: Plan): PlanAction[] {
  const writes = plan.actions.filter((a) => a.op === 'create' || a.op === 'update' || a.op === 'adopt')
  const deletes = plan.actions.filter((a) => a.op === 'delete')
  const rank = (k: ConfigKind) => CONFIG_KINDS.indexOf(k)
  return [...writes.sort((a, b) => rank(a.kind) - rank(b.kind)), ...deletes.sort((a, b) => rank(b.kind) - rank(a.kind))]
}
