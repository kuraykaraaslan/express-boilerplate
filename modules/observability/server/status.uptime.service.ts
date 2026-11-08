import 'reflect-metadata'
import { In, MoreThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import UptimeService from './uptime.uptime.service'
import type { CheckStatus } from './uptime.enums'
import { LOCAL_LOCATION } from './probe.quorum'
import { bucketIndex, emptyBuckets, sqlBucketPosition } from './uptime.latency-buckets'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { OBSERVABILITY_SETTING_KEYS } from './observability.setting.keys'

/**
 * Long-window uptime (phase 2), built on the daily rollup rather than raw
 * checks: raw `monitor_checks` age out under retention, and a 90-day number
 * that silently shrinks with the retention window is a lie. The rollup is
 * incremented on every probe write (`bumpDaily`), so "today" is always
 * included and no batch job has to exist for the numbers to be right.
 */

export interface DailyCounts {
  up: number
  degraded: number
  down: number
}

/** (up + degraded) / total · 100 — DEGRADED is available (same rule as the
 *  raw-check calculator). 100 with no samples: an unmeasured window shows no
 *  false outage. */
export function uptimePercent(counts: DailyCounts): number {
  const total = counts.up + counts.degraded + counts.down
  if (total === 0) return 100
  return Math.round(((counts.up + counts.degraded) / total) * 10000) / 100
}

/** UTC calendar day (YYYY-MM-DD) of a timestamp — the rollup bucket key. */
export function utcDayOf(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export type UptimeWindows = Record<'24h' | '7d' | '30d' | '90d', number>

export default class StatusUptimeService {
  /**
   * Whether this tenant keeps planned maintenance out of the uptime figure.
   *
   * Default ON. Counting a scheduled window as downtime makes the number a lie
   * about UNPLANNED availability, which is the only kind a status-page reader
   * is asking about — and it punishes a tenant for announcing their work,
   * which is precisely the behaviour a status page exists to encourage.
   *
   * An unreadable setting reads as ON, matching the default rather than
   * silently switching to the other behaviour on a settings hiccup.
   */
  static async excludesMaintenance(tenantId: string): Promise<boolean> {
    const s = await SettingService
      .getByKeys(tenantId, [OBSERVABILITY_SETTING_KEYS.EXCLUDE_MAINTENANCE_FROM_UPTIME])
      .catch(() => ({} as Record<string, string>))
    return s[OBSERVABILITY_SETTING_KEYS.EXCLUDE_MAINTENANCE_FROM_UPTIME] !== 'false'
  }

  /**
   * Increment today's counters for one probe sample, in ONE transaction: the monitor-level rollup (`monitor_check_daily`, unchanged key) and its
   * location dimension (`monitor_check_daily_location`, phase 10.5, D-OBS-12). Both are atomic UPSERTs on their unique key, so two concurrent probes
   * of the same monitor (or of the same monitor and location) cannot lose or double an increment, and because they commit together the two tables
   * cannot disagree about a sample. Called only when the sample counts at all (the maintenance exclusion happens in the caller, BEFORE this), so the
   * per-location table follows exactly the same exclusion rule as the monitor-level one.
   *
   * `extra.latencyMs` (UP / DEGRADED samples that measured one) also feeds the latency aggregates (count, sum, fixed buckets: see
   * `uptime.latency-buckets.ts`). `extra.locationKey` is the key the sample came from; `local` when the in-process probe took it (or the monitor
   * has no locations). Without `extra` (older callers) only the monitor-level counters move, exactly as before.
   */
  static async bumpDaily(
    tenantId: string, monitorId: string, status: CheckStatus, checkedAt: Date,
    extra: { locationKey?: string | null; latencyMs?: number | null } = {},
  ): Promise<void> {
    const column = status === 'UP' ? 'up' : status === 'DEGRADED' ? 'degraded' : 'down'
    const counters = [column === 'up' ? 1 : 0, column === 'degraded' ? 1 : 0, column === 'down' ? 1 : 0]
    const day = utcDayOf(checkedAt)
    // A latency is only a response time for a sample that got a response.
    const bucket = status !== 'DOWN' && extra.latencyMs != null ? bucketIndex(extra.latencyMs) : null
    const latency = bucket === null ? { count: 0, sum: 0, init: emptyBuckets(), pos: null as number | null }
      : (() => { const init = emptyBuckets(); init[bucket] = 1; return { count: 1, sum: Math.round(extra.latencyMs as number), init, pos: sqlBucketPosition(bucket) } })()
    // The increment of one bucket is a subscripted assignment: it is part of the same atomic UPSERT as the counters (no read-modify-write).
    const bucketSet = (table: string) => latency.pos === null ? '' : `, "latencyBuckets"[${latency.pos}] = "${table}"."latencyBuckets"[${latency.pos}] + 1`
    const upsert = (table: string, keyCols: string[], keyVals: unknown[]) => {
      const cols = [...keyCols, 'day', 'up', 'degraded', 'down', 'latencyCount', 'latencySumMs', 'latencyBuckets']
      const vals = [...keyVals, day, ...counters, latency.count, latency.sum, latency.init]
      const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ')
      return {
        sql: `INSERT INTO "${table}" (${cols.map((c) => `"${c}"`).join(', ')})
       VALUES (${placeholders})
       ON CONFLICT (${[...keyCols, 'day'].map((c) => `"${c}"`).join(', ')})
       DO UPDATE SET "${column}" = "${table}"."${column}" + 1,
         "latencyCount" = "${table}"."latencyCount" + ${latency.count},
         "latencySumMs" = "${table}"."latencySumMs" + ${latency.sum}${bucketSet(table)}`,
        params: vals,
      }
    }
    const monitorLevel = upsert('monitor_check_daily', ['tenantId', 'monitorId'], [tenantId, monitorId])
    const locationKey = (extra.locationKey ?? LOCAL_LOCATION).trim().toLowerCase().slice(0, 64) || LOCAL_LOCATION
    const perLocation = upsert('monitor_check_daily_location', ['tenantId', 'monitorId', 'locationKey'], [tenantId, monitorId, locationKey])
    // Raw UPSERTs on tenant tables — through the chokepoint like any repo call.
    await withTenantTransactionFor(tenantId, async (qr) => {
      await qr.manager.query(monitorLevel.sql, monitorLevel.params)
      await qr.manager.query(perLocation.sql, perLocation.params)
    })
  }

  /** Summed daily counts for a set of monitors since a UTC day (inclusive). */
  private static async countsSince(tenantId: string, monitorIds: string[], sinceDay: string): Promise<DailyCounts> {
    if (monitorIds.length === 0) return { up: 0, degraded: 0, down: 0 }
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheckDaily, (repo) => repo.find({
      where: { tenantId, monitorId: In(monitorIds), day: MoreThanOrEqual(sinceDay) },
    }))
    return rows.reduce<DailyCounts>(
      (acc, r) => ({ up: acc.up + r.up, degraded: acc.degraded + r.degraded, down: acc.down + r.down }),
      { up: 0, degraded: 0, down: 0 },
    )
  }

  /**
   * A component's uptime over the standard windows. 24h reads the raw checks
   * (day-granular rollups cannot resolve it); 7/30/90d read the rollup so
   * they survive raw-check retention.
   */
  static async componentUptime(tenantId: string, componentId: string): Promise<UptimeWindows> {
    const links = await withTenantRepositoryFor(tenantId, StatusComponentMonitor, (repo) =>
      repo.find({ where: { tenantId, componentId } }))
    const monitorIds = links.map((l) => l.monitorId)
    return StatusUptimeService.uptimeWindows(tenantId, monitorIds)
  }

  /** Same windows for an explicit monitor set (single monitor = length 1). */
  static async uptimeWindows(tenantId: string, monitorIds: string[]): Promise<UptimeWindows> {
    const now = new Date()
    const dayMs = 24 * 60 * 60 * 1000

    let last24 = { up: 0, degraded: 0, down: 0 }
    for (const monitorId of monitorIds) {
      const s = await UptimeService.uptime(tenantId, monitorId, { from: new Date(now.getTime() - dayMs), to: now })
      last24 = { up: last24.up + s.up, degraded: last24.degraded + s.degraded, down: last24.down + s.down }
    }

    const sinceDay = (days: number) => utcDayOf(new Date(now.getTime() - (days - 1) * dayMs))
    const [d7, d30, d90] = await Promise.all([
      StatusUptimeService.countsSince(tenantId, monitorIds, sinceDay(7)),
      StatusUptimeService.countsSince(tenantId, monitorIds, sinceDay(30)),
      StatusUptimeService.countsSince(tenantId, monitorIds, sinceDay(90)),
    ])

    return {
      '24h': uptimePercent(last24),
      '7d': uptimePercent(d7),
      '30d': uptimePercent(d30),
      '90d': uptimePercent(d90),
    }
  }
}
