import 'reflect-metadata'
import { In } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import type { TelemetryValue, TelemetryWriteRow } from '@kuraykaraaslan-labs/telemetry/server/telemetry.contract'
import { TelemetryCoalescer } from '@kuraykaraaslan-labs/telemetry/server/telemetry.coalesce'
import { entityIdOf, type TelemetryEntityKind } from '@kuraykaraaslan-labs/telemetry/server/telemetry.kinds'
import { getTelemetryQueryService, type TelemetryQueryService } from '@kuraykaraaslan-labs/telemetry/server/telemetry.query.service'
import { getTelemetryWriter } from '@kuraykaraaslan-labs/telemetry/server/telemetry.writer'
import { Monitor } from './entities/monitor.entity'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { MonitorCheckDailyLocation } from './entities/monitor_check_daily_location.entity'
import { LOCAL_LOCATION } from './probe.quorum'
import { bucketIndex, emptyBuckets } from './uptime.latency-buckets'
import type { SampleStatus } from './uptime.enums'

/**
 * Probe samples on the Core telemetry store (docs/phases/42-telemetry/04 §4.1): every sample `recordOutcome` writes to `monitor_checks`
 * is also a reading of kind `observability.monitor` (entity = the monitor), keyed per probe location: `<loc>.state` (2 up, 1 degraded,
 * 0 down, -1 inconclusive), `<loc>.latency_ms`, `<loc>.status_code`, `<loc>.maintenance` (0/1) and `<loc>.error` (text, capped by the
 * store's string rule). A sample without a location is `local`. Class 90.
 *
 * Cut-over (release N, this one): both are written; the SLA daily tables keep being bumped at write time (maintenance exclusion, the
 * latency histogram and unknown minutes are SLA rules, not storage) and every reader still reads `monitor_checks`. `dailyCountersFromSamples`
 * computes what the daily tables would hold from the store's samples, so the two sources can be compared over the raw window
 * (`compareDailyRollups`, the compare script) before the reads switch and `monitor_checks` goes (release N+1).
 *
 * ED-12: the samples of a sweep coalesce for one second into one writer call per tenant (`TelemetryCoalescer`); a refused row or a
 * failing store is a warning, never a failed probe.
 */
export const MONITOR_KIND = 'observability.monitor'
export const SAMPLE_FIELDS = ['state', 'latency_ms', 'status_code', 'maintenance', 'error'] as const
export type SampleField = (typeof SAMPLE_FIELDS)[number]
/** `<location>.<field>`: a lower-case location of at most 52 characters (so the key stays within the store's 64), then one of the fields. */
export const SAMPLE_KEY = /^([a-z0-9][a-z0-9_-]{0,51})\.(state|latency_ms|status_code|maintenance|error)$/
export const STATE_VALUE: Record<SampleStatus, number> = { UP: 2, DEGRADED: 1, DOWN: 0, UNKNOWN: -1 }
const STATUS_OF_STATE = new Map<number, SampleStatus>(Object.entries(STATE_VALUE).map(([s, v]) => [v, s as SampleStatus]))

export const monitorEntityId = (monitorId: string): string => entityIdOf(MONITOR_KIND, monitorId)
/** The location part of a key: the sample's location key, lower-cased, cut to the key alphabet. */
export const locationPart = (locationKey: string | null | undefined): string =>
  ((locationKey ?? LOCAL_LOCATION).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^[^a-z0-9]+/, '').slice(0, 52)) || LOCAL_LOCATION

export interface SampleInput {
  checkedAt: Date
  status: SampleStatus
  latencyMs: number | null
  statusCode: number | null
  error: string | null
  duringMaintenance: boolean
  locationKey: string | null
}

/** One sample as one row of the kind: the keys of its location. */
export function sampleReading(monitorId: string, s: SampleInput): TelemetryWriteRow {
  const loc = locationPart(s.locationKey)
  const values: Record<string, TelemetryValue> = { [`${loc}.state`]: STATE_VALUE[s.status], [`${loc}.maintenance`]: s.duringMaintenance ? 1 : 0 }
  if (typeof s.latencyMs === 'number' && Number.isFinite(s.latencyMs)) values[`${loc}.latency_ms`] = s.latencyMs
  if (typeof s.statusCode === 'number' && Number.isFinite(s.statusCode)) values[`${loc}.status_code`] = s.statusCode
  if (s.error) values[`${loc}.error`] = s.error.slice(0, 1024)
  return { entityId: monitorEntityId(monitorId), ts: s.checkedAt.getTime(), values }
}

/** The kind: open keys under the sample rule, class 90, readable for the tenant's own monitors, shown to dashboards, written by this module only. */
export const monitorSampleKind: TelemetryEntityKind = {
  kind: MONITOR_KIND,
  label: 'Uptime monitor',
  keys: { mode: 'open', checkKey: (key) => (SAMPLE_KEY.test(key) ? null : 'key_invalid') },
  retention: { fixedClass: 90 },
  async canRead(ctx, entityIds) {
    if (!entityIds.length) return new Set()
    const ids = [...new Set(entityIds.map((e) => e.toLowerCase()))]
    const rows = await withTenantRepositoryFor(ctx.tenantId, Monitor, (repo) => repo.find({ where: { tenantId: ctx.tenantId, monitorId: In(ids) }, select: { monitorId: true } }))
    return new Set(rows.map((r) => monitorEntityId(r.monitorId)))
  },
  exposeToDashboards: true,
  acceptsExternalWrites: false,
  // 500 monitors × 3 locations at one probe a minute are 25 rows/s; well above that, below a runaway
  budgetRowsPerSecond: 2_000,
}

export default monitorSampleKind

let coalescer: TelemetryCoalescer | null = null
/** The process's sample buffer: one writer call per second per tenant (ED-12). */
export function sampleCoalescer(): TelemetryCoalescer {
  coalescer ??= new TelemetryCoalescer({ writer: () => getTelemetryWriter(), warn: (t) => Logger.warn(`[uptime] probe samples: ${t}`) })
  return coalescer
}
/** Tests: a buffer of their own (`undefined` goes back to the process one). */
export function setSampleCoalescerForTests(c: TelemetryCoalescer | undefined): void { coalescer = c ?? null }

/** Called by `recordOutcome` beside its `monitor_checks` row; never awaited, never throws. */
export function recordSample(tenantId: string, monitorId: string, s: SampleInput): void {
  try {
    sampleCoalescer().add(tenantId, MONITOR_KIND, sampleReading(monitorId, s))
  } catch (err) {
    Logger.warn(`[uptime] probe sample not buffered for monitor ${monitorId}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

// ── reads: the samples back from the store, and what the daily tables would hold ───────────────────────────────────────────────

export interface StoredSample {
  t: number
  status: SampleStatus
  latencyMs: number | null
  statusCode: number | null
  error: string | null
  maintenance: boolean
  locationKey: string
}

/** The samples of one stored message: one per location it carries (a probe cycle writes one message per location, so usually one). */
export function samplesOfMessage(m: { ts: number; values: Record<string, TelemetryValue> }): StoredSample[] {
  const byLoc = new Map<string, Partial<Record<SampleField, TelemetryValue>>>()
  for (const [key, v] of Object.entries(m.values)) {
    const hit = SAMPLE_KEY.exec(key)
    if (!hit) continue
    const rec = byLoc.get(hit[1]) ?? byLoc.set(hit[1], {}).get(hit[1])!
    rec[hit[2] as SampleField] = v
  }
  const out: StoredSample[] = []
  for (const [locationKey, r] of byLoc) {
    const state = typeof r.state === 'number' ? STATUS_OF_STATE.get(r.state) : undefined
    if (!state) continue
    out.push({
      t: m.ts, status: state, locationKey,
      latencyMs: typeof r.latency_ms === 'number' ? r.latency_ms : null,
      statusCode: typeof r.status_code === 'number' ? r.status_code : null,
      error: typeof r.error === 'string' ? r.error : null,
      maintenance: r.maintenance === 1 || r.maintenance === true,
    })
  }
  return out
}

/** The samples of a monitor in `[from, to)` from the store (the raw window), oldest first. */
export async function samplesFromStore(tenantId: string, monitorId: string, o: { from: number; to: number; limit?: number }, service: () => TelemetryQueryService = getTelemetryQueryService): Promise<StoredSample[]> {
  const msgs = await service().messages(tenantId, MONITOR_KIND, monitorEntityId(monitorId), o)
  return msgs.flatMap(samplesOfMessage)
}

export interface DailyCounters {
  up: number
  degraded: number
  down: number
  latencyCount: number
  latencySumMs: number
  latencyBuckets: number[]
}
export const emptyCounters = (): DailyCounters => ({ up: 0, degraded: 0, down: 0, latencyCount: 0, latencySumMs: 0, latencyBuckets: emptyBuckets() })
export const utcDayOfMs = (t: number): string => new Date(t).toISOString().slice(0, 10)

/**
 * What `StatusUptimeService.bumpDaily` accumulates for these samples, per UTC day: the monitor-level counters and the per-location ones.
 * The same rules, in one place to compare against: an inconclusive sample counts nowhere; a maintenance sample counts nowhere when the
 * workspace excludes maintenance; a latency is a response time only for a sample that got a response (UP, DEGRADED).
 */
export function dailyCountersFromSamples(samples: readonly StoredSample[], o: { excludeMaintenance: boolean }): Map<string, { monitor: DailyCounters; byLocation: Map<string, DailyCounters> }> {
  const out = new Map<string, { monitor: DailyCounters; byLocation: Map<string, DailyCounters> }>()
  for (const s of samples) {
    if (s.status === 'UNKNOWN') continue
    if (o.excludeMaintenance && s.maintenance) continue
    const day = utcDayOfMs(s.t)
    const d = out.get(day) ?? out.set(day, { monitor: emptyCounters(), byLocation: new Map() }).get(day)!
    const loc = d.byLocation.get(s.locationKey) ?? d.byLocation.set(s.locationKey, emptyCounters()).get(s.locationKey)!
    for (const c of [d.monitor, loc]) {
      if (s.status === 'UP') c.up += 1
      else if (s.status === 'DEGRADED') c.degraded += 1
      else c.down += 1
      const b = s.status !== 'DOWN' && s.latencyMs != null ? bucketIndex(s.latencyMs) : null
      if (b !== null) {
        c.latencyCount += 1
        c.latencySumMs += Math.round(s.latencyMs as number)
        c.latencyBuckets[b] += 1
      }
    }
  }
  return out
}

export interface RollupComparison {
  day: string
  monitorId: string
  samples: number
  fromStore: DailyCounters
  fromTable: DailyCounters | null
  equal: boolean
  locations: Array<{ locationKey: string; fromStore: DailyCounters; fromTable: DailyCounters | null; equal: boolean }>
}

const same = (a: DailyCounters, b: DailyCounters | null): boolean =>
  !!b && a.up === b.up && a.degraded === b.degraded && a.down === b.down && a.latencyCount === b.latencyCount && a.latencySumMs === b.latencySumMs && a.latencyBuckets.join(',') === b.latencyBuckets.join(',')
const rowCounters = (r: { up: number; degraded: number; down: number; latencyCount: number; latencySumMs: string | number; latencyBuckets: number[] }): DailyCounters =>
  ({ up: r.up, degraded: r.degraded, down: r.down, latencyCount: r.latencyCount, latencySumMs: Number(r.latencySumMs), latencyBuckets: [...r.latencyBuckets] })

/** The daily tables against the store for one monitor and UTC day (the cut-over check; `excludeMaintenance` is the workspace's setting at the time). */
export async function compareDailyRollups(tenantId: string, monitorId: string, day: string, o: { excludeMaintenance: boolean }): Promise<RollupComparison> {
  const from = Date.parse(`${day}T00:00:00.000Z`)
  const samples = await samplesFromStore(tenantId, monitorId, { from, to: from + 86_400_000, limit: 50_000 })
  const computed = dailyCountersFromSamples(samples, o).get(day) ?? { monitor: emptyCounters(), byLocation: new Map<string, DailyCounters>() }
  const row = await withTenantRepositoryFor(tenantId, MonitorCheckDaily, (repo) => repo.findOne({ where: { tenantId, monitorId, day } }))
  const locRows = await withTenantRepositoryFor(tenantId, MonitorCheckDailyLocation, (repo) => repo.find({ where: { tenantId, monitorId, day } }))
  const fromTable = row ? rowCounters(row) : null
  const locKeys = [...new Set([...computed.byLocation.keys(), ...locRows.map((r) => r.locationKey)])].sort()
  const locations = locKeys.map((locationKey) => {
    const s = computed.byLocation.get(locationKey) ?? emptyCounters()
    const t = locRows.find((r) => r.locationKey === locationKey)
    const tc = t ? rowCounters(t) : null
    return { locationKey, fromStore: s, fromTable: tc, equal: same(s, tc) }
  })
  return { day, monitorId, samples: samples.length, fromStore: computed.monitor, fromTable, equal: same(computed.monitor, fromTable) && locations.every((l) => l.equal), locations }
}
