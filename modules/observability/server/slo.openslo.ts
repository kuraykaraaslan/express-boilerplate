import YAML from 'yaml'
import { CreateSloDTO, type CreateSloInput } from './slo.dto'
import type { Slo } from './entities/slo.entity'

/**
 * OpenSLO v1 interchange (observability phase 13.6): the subset that means the same thing on both sides.
 *
 * What maps: one objective (the target as a fraction), one rolling time window in whole days (7, 28, 30 or 90), the `Occurrences`
 * budgeting method, and a ratio indicator whose good and total come from a metric source. A monitor-based SLO exports with the metric source
 * type `roltek.monitor`; a metric-based one exports with `prometheus` and its two queries. What does not map is REFUSED with a reason and
 * never guessed at: time-sliced budgeting, calendar windows, several objectives, threshold indicators, other source types.
 *
 * OpenSLO v2 is not tracked: its repository looked stalled when this was written.
 */

export const OPENSLO_VERSION = 'openslo/v1'
export const ROLTEK_MONITOR_SOURCE = 'roltek.monitor'

type SloLike = Pick<Slo, 'name' | 'description' | 'kind' | 'objectivePercent' | 'windowDays' | 'monitorIds' | 'componentId' | 'latencyThresholdMs' | 'metricSpec'>

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 63) || 'slo'

export function toOpenSlo(slo: SloLike): Record<string, unknown> {
  const monitorSpec = (kind: string) => ({ metricSource: { type: ROLTEK_MONITOR_SOURCE, spec: { measure: kind, monitorIds: slo.monitorIds, ...(slo.componentId ? { componentId: slo.componentId } : {}), ...(slo.latencyThresholdMs ? { thresholdMs: slo.latencyThresholdMs } : {}) } } })
  const ratio = slo.kind === 'METRIC_RATIO'
    ? { counter: true, good: { metricSource: { type: 'prometheus', spec: { query: slo.metricSpec?.goodQuery } } }, total: { metricSource: { type: 'prometheus', spec: { query: slo.metricSpec?.totalQuery } } } }
    : { counter: true, good: monitorSpec(slo.kind === 'MONITOR_LATENCY' ? 'fast' : 'available'), total: monitorSpec('all') }
  return {
    apiVersion: OPENSLO_VERSION, kind: 'SLO',
    metadata: { name: slug(slo.name), displayName: slo.name },
    spec: {
      ...(slo.description ? { description: slo.description } : {}),
      service: slug(slo.name),
      indicator: { metadata: { name: `${slug(slo.name)}-sli` }, spec: { ratioMetric: ratio } },
      timeWindow: [{ duration: `${slo.windowDays}d`, isRolling: true }],
      budgetingMethod: 'Occurrences',
      objectives: [{ displayName: slo.name, target: Math.round(Number(slo.objectivePercent) * 1000) / 100_000 }],
    },
  }
}

export function stringifyOpenSlos(slos: readonly SloLike[], format: 'yaml' | 'json'): string {
  const docs = slos.map(toOpenSlo)
  return format === 'json' ? JSON.stringify(docs, null, 2) : docs.map((d) => YAML.stringify(d)).join('---\n')
}

export interface OpenSloImport { slos: CreateSloInput[]; errors: { document: number; message: string }[] }

const asObj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)

function convert(doc: unknown): CreateSloInput | string {
  const d = asObj(doc)
  if (!d) return 'not an object'
  if (d.apiVersion !== OPENSLO_VERSION) return `unsupported apiVersion ${String(d.apiVersion)} (only ${OPENSLO_VERSION})`
  if (d.kind !== 'SLO') return `unsupported kind ${String(d.kind)} (only SLO is imported)`
  const metadata = asObj(d.metadata); const spec = asObj(d.spec)
  if (!metadata || !spec) return 'missing metadata or spec'
  const name = String(metadata.displayName ?? metadata.name ?? '').trim()
  if (!name) return 'missing metadata.name'
  if (spec.budgetingMethod !== 'Occurrences') return `budgetingMethod ${String(spec.budgetingMethod)} is not supported (only Occurrences)`

  const windows = Array.isArray(spec.timeWindow) ? spec.timeWindow : []
  if (windows.length !== 1) return 'exactly one timeWindow is supported'
  const w = asObj(windows[0])
  const dur = /^(\d{1,3})d$/.exec(String(w?.duration ?? ''))
  if (!dur) return 'only day-based windows such as 30d are supported'
  if (w?.isRolling !== true) return 'only rolling windows are supported'

  const objectives = Array.isArray(spec.objectives) ? spec.objectives : []
  if (objectives.length !== 1) return 'exactly one objective is supported'
  const target = Number(asObj(objectives[0])?.target)
  if (!(target > 0.5 && target < 1)) return 'objective target must be a fraction between 0.5 and 1 (exclusive)'

  const indicator = asObj(asObj(spec.indicator)?.spec)
  const ratio = asObj(indicator?.ratioMetric)
  if (!ratio) return 'only ratioMetric indicators are supported (thresholdMetric is not)'
  const good = asObj(asObj(ratio.good)?.metricSource); const total = asObj(asObj(ratio.total)?.metricSource)
  if (!good || !total) return 'ratioMetric needs a good and a total metricSource'

  const base = { name, description: typeof spec.description === 'string' ? spec.description : null, objectivePercent: Math.round(target * 100_000) / 1000, windowDays: Number(dur[1]) }
  if (good.type === ROLTEK_MONITOR_SOURCE) {
    const g = asObj(good.spec) ?? {}
    const measure = g.measure
    return {
      ...base, kind: measure === 'fast' ? 'MONITOR_LATENCY' : 'MONITOR_AVAILABILITY',
      monitorIds: Array.isArray(g.monitorIds) ? g.monitorIds.filter((x): x is string => typeof x === 'string') : [],
      componentId: typeof g.componentId === 'string' ? g.componentId : null,
      latencyThresholdMs: typeof g.thresholdMs === 'number' ? g.thresholdMs : null,
    } as unknown as CreateSloInput
  }
  if (good.type === 'prometheus' && total.type === 'prometheus') {
    const gq = asObj(good.spec)?.query; const tq = asObj(total.spec)?.query
    if (typeof gq !== 'string' || typeof tq !== 'string') return 'prometheus metric sources need a query'
    return { ...base, kind: 'METRIC_RATIO', monitorIds: [], metricSpec: { goodQuery: gq, totalQuery: tq } } as unknown as CreateSloInput
  }
  return `metric source type ${String(good.type)} is not supported (only ${ROLTEK_MONITOR_SOURCE} and prometheus)`
}

/** Parse OpenSLO documents (YAML multi-document or a JSON list) into SLO definitions, validated by the same DTO as a hand-made one. */
export function parseOpenSlo(format: 'yaml' | 'json', content: string): OpenSloImport {
  let docs: unknown[]
  try {
    docs = format === 'json'
      ? (() => { const v = JSON.parse(content); return Array.isArray(v) ? v : [v] })()
      : YAML.parseAllDocuments(content).map((d) => { if (d.errors.length) throw new Error(d.errors[0].message); return d.toJS({ maxAliasCount: 10 }) })
  } catch (err) {
    return { slos: [], errors: [{ document: 0, message: `could not parse ${format}: ${(err instanceof Error ? err.message : String(err)).slice(0, 120)}` }] }
  }
  docs = docs.filter((d) => d !== null && d !== undefined)
  if (docs.length === 0) return { slos: [], errors: [{ document: 0, message: 'no documents found' }] }
  if (docs.length > 100) return { slos: [], errors: [{ document: 0, message: 'at most 100 documents per import' }] }
  const out: OpenSloImport = { slos: [], errors: [] }
  docs.forEach((doc, i) => {
    const converted = convert(doc)
    if (typeof converted === 'string') { out.errors.push({ document: i + 1, message: converted }); return }
    const checked = CreateSloDTO.safeParse(converted)
    if (checked.success) out.slos.push(checked.data)
    else out.errors.push({ document: i + 1, message: `${checked.error.issues[0].path.join('.') || 'slo'}: ${checked.error.issues[0].message}`.slice(0, 200) })
  })
  return out
}
