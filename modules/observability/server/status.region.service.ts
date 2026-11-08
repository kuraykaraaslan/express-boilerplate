import 'reflect-metadata'
import { In, MoreThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { Monitor } from './entities/monitor.entity'
import { MonitorCheckDailyLocation } from './entities/monitor_check_daily_location.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import ProbeLocationService from './probe.location.service'
import { LOCAL_LOCATION, staleAfterMs, type LocationStates } from './probe.quorum'
import { deriveComponentStatus } from './status.component.service'
import type { MonitorStatus } from './uptime.enums'

/**
 * The region breakdown of a status page (observability phase 10.5 item b): per component, the status and the uptime of each probe location
 * the tenant chose to expose, from the per-location data the module already keeps (the debounced per-location verdicts of the quorum code, and the
 * per-location daily rollup).
 *
 * What may leave this file, per region, is exactly `{ regionId, label, status, uptime }`:
 *  - `regionId` is opaque and stable (a hash of the tenant and the location row, never the key);
 *  - `label` is the PUBLIC label of the location (a private location has none until the tenant writes one for the page);
 *  - `status` is derived below, `uptime` comes from the rollup.
 * No location key, runner id, heartbeat time, version, monitor id or monitor name is ever read into the output: `ProbeLocationService.exposedForStatus`
 * is the single gate that decides which locations are visible at all, and a location it does not return is simply not part of the page. Nothing is
 * aggregated across tenants: every read is tenant-scoped.
 *
 * Reads: the component-to-monitor links, the monitors' location verdicts, the exposure gate (own locations plus the ROOT catalogue) and the
 * per-location rollup: five queries for the whole page, whatever the number of components.
 */

export interface PublicRegion {
  /** Opaque, stable, per tenant. */
  regionId: string
  /** The location's public label. */
  label: string
  /** The component's status as seen from this location (the same vocabulary as the component's own status; the serializer applies the maintenance projection). */
  status: string
  /** Uptime over 7, 30 and 90 days from the per-location rollup; a window with no per-location samples is null (never 100: it is unmeasured). Null when the component hides its uptime. */
  uptime: RegionUptime | null
}
export type RegionUptime = Record<'7d' | '30d' | '90d', number | null>

export interface RegionComponentInput { componentId: string; showUptime: boolean }

const DAY_MS = 86_400_000
const utcDayOf = (d: Date) => d.toISOString().slice(0, 10)

type MonitorView = Pick<Monitor, 'monitorId' | 'locations' | 'locationState' | 'lastStatus' | 'lastCheckedAt' | 'intervalSeconds'>

/**
 * One monitor's vote for one location, or null when it has none: the location is not one of the monitor's, it has not reported recently enough
 * (a dead runner is not an outage of the target, and must not hide one either), or it is still settling.
 *
 * With two or more locations the monitor keeps a debounced state per location (the quorum code); with exactly one remote location the monitor's own
 * debounced status IS that location's state.
 */
export function monitorVoteAt(m: MonitorView, key: string, now: Date): MonitorStatus | null {
  const locations = m.locations ?? []
  if (!locations.includes(key)) return null
  const horizon = now.getTime() - staleAfterMs(m.intervalSeconds)
  let status: string | undefined
  let at: number
  if (locations.length > 1) {
    const st = (m.locationState as LocationStates | null | undefined)?.[key]
    if (!st) return null
    status = st.status; at = Date.parse(st.at)
  } else {
    status = m.lastStatus; at = m.lastCheckedAt ? new Date(m.lastCheckedAt).getTime() : Number.NaN
  }
  if (!Number.isFinite(at) || at < horizon) return null
  return status === 'UP' || status === 'DOWN' || status === 'DEGRADED' ? status : null
}

/** A component's status from one location: the same worst-of rule as the component itself, over the monitors that run there. Null with no vote. */
export function regionStatus(monitors: readonly MonitorView[], key: string, now: Date): string | null {
  const votes = monitors.map((m) => monitorVoteAt(m, key, now)).filter((v): v is MonitorStatus => v !== null)
  return votes.length === 0 ? null : deriveComponentStatus(votes)
}

function percent(c: { up: number; degraded: number; down: number }): number | null {
  const total = c.up + c.degraded + c.down
  return total === 0 ? null : Math.round(((c.up + c.degraded) / total) * 10000) / 100
}

export default class StatusRegionService {
  /**
   * The regions of each component asked for, keyed by component id. A component with no exposed live location gets an empty list (the page then
   * draws nothing for it).
   */
  static async load(
    tenantId: string, components: readonly RegionComponentInput[], opts: { now?: Date } = {},
  ): Promise<Map<string, PublicRegion[]>> {
    const now = opts.now ?? new Date()
    const out = new Map<string, PublicRegion[]>(components.map((c) => [c.componentId, []]))
    if (components.length === 0) return out

    const links = await withTenantRepositoryFor(tenantId, StatusComponentMonitor, (repo) =>
      repo.find({ where: { tenantId, componentId: In(components.map((c) => c.componentId)) } }))
    const monitorIds = [...new Set(links.map((l) => l.monitorId))]
    if (monitorIds.length === 0) return out

    const monitors = await withTenantRepositoryFor(tenantId, Monitor, (repo) => repo.find({
      where: { tenantId, monitorId: In(monitorIds) },
      select: { monitorId: true, locations: true, locationState: true, lastStatus: true, lastCheckedAt: true, intervalSeconds: true },
    })) as MonitorView[]
    const monitorById = new Map(monitors.map((m) => [m.monitorId, m]))

    const keys = [...new Set(monitors.flatMap((m) => m.locations ?? []))].filter((k) => k !== LOCAL_LOCATION)
    const exposed = await ProbeLocationService.exposedForStatus(tenantId, keys, now)
    if (exposed.size === 0) return out

    const since = utcDayOf(new Date(now.getTime() - 89 * DAY_MS))
    const needUptime = components.some((c) => c.showUptime)
    const rollups = needUptime
      ? await withTenantRepositoryFor(tenantId, MonitorCheckDailyLocation, (repo) => repo.find({
        where: { tenantId, monitorId: In(monitorIds), day: MoreThanOrEqual(since) },
      }))
      : []
    const windows: Array<['7d' | '30d' | '90d', string]> = [
      ['7d', utcDayOf(new Date(now.getTime() - 6 * DAY_MS))], ['30d', utcDayOf(new Date(now.getTime() - 29 * DAY_MS))], ['90d', since],
    ]

    for (const c of components) {
      const mine = links.filter((l) => l.componentId === c.componentId).map((l) => monitorById.get(l.monitorId)).filter((m): m is MonitorView => !!m)
      const myIds = new Set(mine.map((m) => m.monitorId))
      const regions: PublicRegion[] = []
      for (const [key, loc] of exposed) {
        const status = regionStatus(mine, key, now)
        if (status === null) continue
        let uptime: RegionUptime | null = null
        if (c.showUptime) {
          uptime = { '7d': null, '30d': null, '90d': null }
          for (const [name, from] of windows) {
            const sum = { up: 0, degraded: 0, down: 0 }
            for (const r of rollups) {
              if (r.locationKey !== key || !myIds.has(r.monitorId) || String(r.day).slice(0, 10) < from) continue
              sum.up += r.up; sum.degraded += r.degraded; sum.down += r.down
            }
            uptime[name] = percent(sum)
          }
        }
        regions.push({ regionId: loc.regionId, label: loc.label, status, uptime })
      }
      regions.sort((a, b) => a.label.localeCompare(b.label) || a.regionId.localeCompare(b.regionId))
      out.set(c.componentId, regions)
    }
    return out
  }
}
