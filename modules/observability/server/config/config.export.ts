import type { ObservabilityConfig } from './config.dto'
import { CONFIG_SCHEMA_ID } from './config.dto'
import { MANAGED_BY_CODE, keyOfSource, slugKey, uniqueKey } from './config.kinds'
import type { LiveSnapshot } from './config.plan'
import { browserStartUrl } from '../uptime.browser.schema'

/**
 * The live state as a document (observability phase 21.3 `export`). Keys are the file keys of code-managed rows and a readable slug of the
 * name for the rest, so an export can be committed and then applied with `adopt` to take the console's resources under code without
 * creating duplicates.
 *
 * What an export never contains: header values and step secrets (a header is written as a reference to an environment variable the operator
 * has to provide, a secret likewise), ingest keys, heartbeat tokens, live silences, pause and maintenance windows.
 */

type Row = Record<string, unknown>

/** Keep the order of the keys, drop what is null, undefined or an empty list or object (the defaults restore them). */
function compact(o: Row): Row {
  const out: Row = {}
  for (const [k, v] of Object.entries(o)) {
    if (v === null || v === undefined) continue
    if (Array.isArray(v) && v.length === 0) continue
    if (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0) continue
    out[k] = v
  }
  return out
}

/** An environment variable name for a secret of an exported monitor: `OBS_<KEY>_HEADER_<NAME>` / `OBS_<KEY>_SECRET_<NAME>`. */
export function exportEnvName(key: string, what: 'HEADER' | 'SECRET', name: string): string {
  const up = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const base = `OBS_${up(key)}_${what}_${up(name)}`
  return /^[A-Za-z_]/.test(base) ? base.slice(0, 100) : `_${base}`.slice(0, 100)
}

export interface ExportOptions {
  /** `managed`: only what is already under code. `all` (default): everything, with derived keys for the console's resources. */
  scope?: 'all' | 'managed'
}

export interface ExportResult { document: ObservabilityConfig; warnings: string[] }

export function exportConfig(snap: LiveSnapshot, opts: ExportOptions = {}): ExportResult {
  const warnings: string[] = []
  const only = (rows: Row[] | undefined) => (rows ?? []).filter((r) => opts.scope !== 'managed' || r.managedBy === MANAGED_BY_CODE)

  /** A key per row: the file key when managed, else a unique slug of the name. */
  const keyer = (rows: Row[], idField: string) => {
    const taken = new Set<string>()
    const byId = new Map<string, string>()
    for (const r of rows) {
      const k = r.managedBy === MANAGED_BY_CODE ? keyOfSource(r.sourceKey as string | null) : null
      if (k) { taken.add(k); byId.set(r[idField] as string, k) }
    }
    for (const r of rows) if (!byId.has(r[idField] as string)) byId.set(r[idField] as string, uniqueKey(slugKey(String(r.name ?? ''), 'item'), taken))
    return byId
  }

  const monitors = only(snap.monitors)
  // A provider-managed monitor belongs to its module; it is not part of anyone's repository.
  const exportable = monitors.filter((m) => !m.sourceKey || m.managedBy === MANAGED_BY_CODE)
  const monitorKeys = keyer(exportable, 'monitorId')
  const components = only(snap.components)
  const componentKeys = keyer(components, 'componentId')
  const ref = (kind: 'monitor' | 'component', id: string): string | null => (kind === 'monitor' ? monitorKeys : componentKeys).get(id) ?? null

  const doc: ObservabilityConfig = {
    schema: CONFIG_SCHEMA_ID,
    monitors: exportable.map((m) => {
      const key = monitorKeys.get(m.monitorId as string) as string
      const headers = m.headers as Record<string, string> | null
      const secrets = m.secrets as Record<string, string> | null
      const placeholder = (what: 'HEADER' | 'SECRET', n: string) => ({ fromEnv: exportEnvName(key, what, n) })
      const target = (m.type === 'HEARTBEAT' && m.target === 'heartbeat') || (m.type === 'STEPS' && m.target === 'steps') || (m.type === 'BROWSER' && m.target === browserStartUrl(m.browser)) ? undefined : m.target
      return compact({
        key, name: m.name, type: m.type, target, intervalSeconds: m.intervalSeconds, timeoutMs: m.timeoutMs, expectedStatus: m.expectedStatus,
        expectedBodyContains: m.expectedBodyContains, degradedLatencyMs: m.degradedLatencyMs,
        headers: headers ? Object.fromEntries(Object.keys(headers).map((n) => [n, placeholder('HEADER', n)])) : undefined,
        consecutiveFailThreshold: m.consecutiveFailThreshold, isActive: m.isActive, assertions: m.assertions, certWarnDays: m.certWarnDays,
        certCriticalDays: m.certCriticalDays, heartbeatGraceSeconds: m.heartbeatGraceSeconds, steps: m.steps, browser: m.browser,
        ...(m.type === 'BROWSER' ? { locations: m.locations, quorum: m.quorum } : {}),
        secrets: secrets ? Object.fromEntries(Object.keys(secrets).map((n) => [n, placeholder('SECRET', n)])) : undefined,
        latencyBaselineFactor: m.latencyBaselineFactor, groupName: m.groupName, tags: m.tags,
      })
    }) as ObservabilityConfig['monitors'],
    components: components.map((c) => compact({
      key: componentKeys.get(c.componentId as string), name: c.name, description: c.description, order: c.order, isPublic: c.isPublic,
      monitors: ((c.monitorIds as string[]) ?? []).flatMap((id) => {
        const k = ref('monitor', id)
        if (k === null) { warnings.push(`component "${String(c.name)}": a linked monitor is not part of this export and was left out`); return [] }
        return [k]
      }),
    })) as ObservabilityConfig['components'],
    slos: only(snap.slos).map((s) => {
      const sloKeys = keyer(only(snap.slos), 'sloId')
      const monitorsOf = ((s.monitorIds as string[]) ?? []).flatMap((id) => {
        const k = ref('monitor', id)
        if (k === null) { warnings.push(`SLO "${String(s.name)}": a monitor is not part of this export and was left out`); return [] }
        return [k]
      })
      const component = s.componentId ? ref('component', s.componentId as string) : null
      if (s.componentId && component === null) warnings.push(`SLO "${String(s.name)}": its component is not part of this export and was left out`)
      return compact({
        key: sloKeys.get(s.sloId as string), name: s.name, description: s.description, kind: s.kind, objectivePercent: s.objectivePercent, windowDays: s.windowDays,
        monitors: monitorsOf, component, latencyThresholdMs: s.latencyThresholdMs, metricSpec: s.metricSpec, lowBudgetPercent: s.lowBudgetPercent,
        burnAlerts: s.burnAlerts, isActive: s.isActive,
      })
    }) as ObservabilityConfig['slos'],
    silenceTemplates: (() => {
      const rows = only(snap.silenceTemplates); const keys = keyer(rows, 'templateId')
      return rows.map((t) => compact({ key: keys.get(t.templateId as string), name: t.name, matchers: t.matchers, durationMinutes: t.durationMinutes, reason: t.reason }))
    })() as ObservabilityConfig['silenceTemplates'],
    integrations: (() => {
      const rows = only(snap.integrations); const keys = keyer(rows, 'integrationId')
      return rows.map((i) => compact({ key: keys.get(i.integrationId as string), name: i.name, kind: i.kind, severityCeiling: i.severityCeiling, defaultLabels: i.defaultLabels, enabled: i.enabled }))
    })() as ObservabilityConfig['integrations'],
    routes: (() => {
      const rows = [...only(snap.routes)].sort((a, b) => Number(a.position) - Number(b.position)); const keys = keyer(rows, 'routeId')
      return rows.map((r) => compact({
        key: keys.get(r.routeId as string), name: r.name, matchers: r.matchers, groupBy: r.groupBy, groupWaitSeconds: r.groupWaitSeconds,
        groupIntervalSeconds: r.groupIntervalSeconds, targets: r.targets, incident: r.incident, continueMatching: r.continueMatching, enabled: r.enabled,
      }))
    })() as ObservabilityConfig['routes'],
    dependencies: only(snap.dependencies).flatMap((d) => {
      const end = (v: string): string | null => {
        const m = /^(component|monitor):(.+)$/.exec(v)
        if (!m) return v
        const k = ref(m[1] as 'monitor' | 'component', m[2])
        return k === null ? null : `${m[1]}:${k}`
      }
      const child = end(d.child as string); const parent = end(d.parent as string)
      if (child === null || parent === null) { warnings.push('a dependency points at an entity that is not part of this export and was left out'); return [] }
      return [{ child, parent }]
    }),
    incidentTemplates: only(snap.incidentTemplates).map((t) => ({ status: t.status, locale: t.locale, body: t.body })) as ObservabilityConfig['incidentTemplates'],
  }
  return { document: doc, warnings }
}
