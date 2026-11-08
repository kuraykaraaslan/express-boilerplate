import 'reflect-metadata'
import { In, MoreThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import { HISTORY_DAYS, lastDays, type DayCounts } from './status.history'

/**
 * The reads behind the 90-day bars: which monitors answer for each component and their daily rollup, in two queries for the whole
 * page rather than two per component. The rollup survives raw-check retention, so a bar never shrinks with the retention setting.
 */
export interface HistorySource {
  days: string[]
  monitorsByComponent: Map<string, string[]>
  countsByMonitorDay: Map<string, Map<string, DayCounts>>
}

export default class StatusHistoryService {
  static async load(tenantId: string, componentIds: readonly string[], now: Date = new Date()): Promise<HistorySource> {
    const days = lastDays(HISTORY_DAYS, now)
    const monitorsByComponent = new Map<string, string[]>()
    const countsByMonitorDay = new Map<string, Map<string, DayCounts>>()
    if (componentIds.length === 0) return { days, monitorsByComponent, countsByMonitorDay }

    const links = await withTenantRepositoryFor(tenantId, StatusComponentMonitor, (repo) =>
      repo.find({ where: { tenantId, componentId: In([...componentIds]) } }))
    for (const l of links) monitorsByComponent.set(l.componentId, [...(monitorsByComponent.get(l.componentId) ?? []), l.monitorId])

    const monitorIds = [...new Set(links.map((l) => l.monitorId))]
    if (monitorIds.length === 0) return { days, monitorsByComponent, countsByMonitorDay }
    const rows = await withTenantRepositoryFor(tenantId, MonitorCheckDaily, (repo) =>
      repo.find({ where: { tenantId, monitorId: In(monitorIds), day: MoreThanOrEqual(days[0]) } }))
    for (const r of rows) {
      const perDay = countsByMonitorDay.get(r.monitorId) ?? new Map<string, DayCounts>()
      perDay.set(String(r.day).slice(0, 10), { up: r.up, degraded: r.degraded, down: r.down })
      countsByMonitorDay.set(r.monitorId, perDay)
    }
    return { days, monitorsByComponent, countsByMonitorDay }
  }
}
