import 'reflect-metadata'
import { In, MoreThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import { aggregateOf, buildLatencySeries, type LatencyAggregate, type LatencySeries } from './uptime.latency-buckets'
import { lastDays } from './status.history'

/**
 * The response-time chart of a status page (observability phase 15.6): per component, one point per day for the last `RESPONSE_TIME_DAYS` days,
 * built ONLY from the daily rollup's latency aggregates (the exact average and the approximate p95, see `uptime.latency-buckets.ts`). It never reads a
 * raw check: a per-check latency never leaves the module, and the chart survives raw-check retention like the uptime bars do.
 *
 * The component's monitors are merged by adding their counters (a component with two monitors reports the average and p95 of the samples of both,
 * not the better of two numbers). Two reads for the whole page, whatever the number of components.
 */
export const RESPONSE_TIME_DAYS = 30

export default class StatusLatencyService {
  static async load(tenantId: string, componentIds: readonly string[], now: Date = new Date()): Promise<Map<string, LatencySeries>> {
    const out = new Map<string, LatencySeries>()
    if (componentIds.length === 0) return out
    const days = lastDays(RESPONSE_TIME_DAYS, now)
    const links = await withTenantRepositoryFor(tenantId, StatusComponentMonitor, (repo) =>
      repo.find({ where: { tenantId, componentId: In([...componentIds]) } }))
    const monitorIds = [...new Set(links.map((l) => l.monitorId))]
    const rows = monitorIds.length === 0 ? [] : await withTenantRepositoryFor(tenantId, MonitorCheckDaily, (repo) =>
      repo.find({ where: { tenantId, monitorId: In(monitorIds), day: MoreThanOrEqual(days[0]) } }))
    const byMonitorDay = new Map<string, Map<string, LatencyAggregate>>()
    for (const r of rows) {
      const perDay = byMonitorDay.get(r.monitorId) ?? new Map<string, LatencyAggregate>()
      perDay.set(String(r.day).slice(0, 10), aggregateOf(r))
      byMonitorDay.set(r.monitorId, perDay)
    }
    for (const componentId of componentIds) {
      const mine = links.filter((l) => l.componentId === componentId).map((l) => l.monitorId)
      const perDay = new Map<string, LatencyAggregate>()
      for (const day of days) {
        const parts = mine.map((m) => byMonitorDay.get(m)?.get(day)).filter((a): a is LatencyAggregate => !!a && a.count > 0)
        if (parts.length === 0) continue
        perDay.set(day, parts.reduce((acc, a) => ({
          count: acc.count + a.count, sumMs: acc.sumMs + a.sumMs, buckets: acc.buckets.map((n, i) => n + (a.buckets[i] ?? 0)),
        })))
      }
      out.set(componentId, buildLatencySeries(days, perDay))
    }
    return out
  }
}
