import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import type { Monitor } from './entities/monitor.entity'
import type { AlertSignal } from './alert.ingest.parsers'
import { RUNBOOKS } from './observability.runbooks'

/**
 * A monitor outage, as an alert signal (observability phase 11).
 *
 * The alert's identity is the MONITOR, not its labels: the sender fingerprint is `monitor:<id>`, so renaming a monitor while it is down
 * cannot orphan the alert (the recovery would otherwise look like a different alert and never resolve it). The labels carry what a route
 * needs to match on: the monitor, its type, its group, and an `entity` list (the monitor itself plus every status component it feeds), which
 * is what the dependency graph acts on.
 */
export async function componentEntitiesOf(tenantId: string, monitorId: string): Promise<string[]> {
  const links = await withTenantRepositoryFor(tenantId, StatusComponentMonitor, (repo) => repo.find({ where: { tenantId, monitorId } })).catch(() => [])
  return links.map((l) => `component:${l.componentId}`)
}

/**
 * The runbook a managed monitor's alert points to. A monitor made by a provider (`sourceKey` = `<module>:<key>`) says what it watches, so the alert
 * can carry the steps: the telemetry stores' readiness monitors (observability's own `telemetry-store-*` targets) link the store-full runbook.
 */
export function runbookFor(sourceKey: string | null | undefined): { runbook?: string } {
  if (sourceKey?.startsWith('observability:telemetry-store-')) return { runbook: RUNBOOKS.telemetryStore }
  return {}
}

export function monitorAlertSignal(
  monitor: Pick<Monitor, 'monitorId' | 'name' | 'type' | 'groupName' | 'tags'> & { sourceKey?: string | null },
  status: 'FIRING' | 'RESOLVED',
  detail: { error?: string | null; duringMaintenance?: boolean; componentEntities?: string[] },
): AlertSignal {
  const entity = [`monitor:${monitor.monitorId}`, ...(detail.componentEntities ?? [])].join(',').slice(0, 500)
  return {
    source: 'monitor', sourceRef: monitor.monitorId, status, severity: 'MAJOR',
    title: `${monitor.name} is down`.slice(0, 300),
    fingerprint: `monitor:${monitor.monitorId}`,
    labels: {
      alertname: 'MonitorDown', monitor: monitor.name.slice(0, 200), monitorId: monitor.monitorId, type: monitor.type, entity,
      ...(monitor.groupName ? { group: monitor.groupName } : {}),
    },
    annotations: { summary: detail.error ?? 'Probe failed', reason: detail.error ?? 'Probe failed', ...runbookFor(monitor.sourceKey) },
    duringMaintenance: detail.duringMaintenance === true,
    monitorId: monitor.monitorId,
  }
}
