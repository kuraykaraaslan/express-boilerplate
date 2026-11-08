import 'reflect-metadata'
import { In, IsNull, LessThanOrEqual } from 'typeorm'
import { withTenantRepositoryFor, withTenantTransactionFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service'
import { Alert } from './entities/alert.entity'
import { AlertRoute } from './entities/alert_route.entity'
import IncidentService from './incident.service'
import { recordIncidentEvent } from './incident.timeline.service'
import { alertFingerprint } from './alert.fingerprint'
import { incidentSeverityOf, maxSeverity, type AlertSeverity } from './alert.enums'
import { readRouteTargets, type RouteTarget } from './alert.decision'
import { INCIDENT_POLICY_SETTING_KEYS, incidentActionFor, readIncidentPolicy } from './alert.policy'
import { resolveOnCallPages, runResolvedTargets, runTargets, summarize } from './alert.targets'
import { alertMetrics } from './alert.metrics'
import { IncidentActionEnum, type IncidentAction } from './alert.enums'

/**
 * Announcing a group of alerts (observability phase 11): open the incident the policy asks for, run the targets of the route(s) that
 * claimed them, and mark them announced.
 *
 * At-least-once on purpose. Claiming a group sets a short LEASE (`dispatchAfter` a couple of minutes ahead), the side effects run, and
 * only then are the alerts marked announced. A crash in between lets the lease lapse and the sweep announces the group again: a repeated
 * message is recoverable, a lost alert is not. The notification call carries an idempotency key so the repeat is not delivered twice.
 */

const LEASE_MS = 120_000
const OPEN_STATUSES = ['FIRING', 'SUPPRESSED']
const MAX_GROUPS_PER_SWEEP = 200

export interface DispatchSummary { announced: number; incidentId: string | null; targetFailures: number }

async function loadPolicy(tenantId: string): Promise<Record<AlertSeverity, IncidentAction>> {
  const keys = Object.values(INCIDENT_POLICY_SETTING_KEYS)
  const values = await SettingService.getByKeys(tenantId, keys).catch(() => ({} as Record<string, string>))
  return readIncidentPolicy(values)
}

/** The labels of the alert that says a route target could not deliver. One per target type, so a repeat is a counter. */
export function targetUnavailableLabels(type: string): Record<string, string> {
  return { alertname: 'AlertTargetUnavailable', targettype: type, entity: `alert-target:${type}` }
}

async function raiseTargetUnavailable(tenantId: string, type: string, reason: string): Promise<void> {
  // Dynamic: the service imports this file, so a static import would be a cycle.
  const { default: AlertService } = await import('./alert.service')
  await AlertService.ingest(tenantId, {
    source: 'extension', sourceRef: 'observability', status: 'FIRING', severity: 'WARNING',
    title: `Alert target "${type}" could not deliver`,
    labels: targetUnavailableLabels(type),
    annotations: { summary: reason },
  })
}

async function clearTargetUnavailable(tenantId: string, type: string): Promise<void> {
  const { default: AlertService } = await import('./alert.service')
  await AlertService.resolve(tenantId, { fingerprint: alertFingerprint('extension', targetUnavailableLabels(type)) })
}

export async function dispatchGroup(tenantId: string, groupKey: string, now: Date = new Date()): Promise<DispatchSummary> {
  // 1. Claim: take a lease on the alerts that are due, in one locked step, so two dispatchers never announce the same group.
  const claimed = await withTenantTransactionFor(tenantId, async (qr) => {
    const repo = qr.manager.getRepository(Alert)
    const due = await repo.find({
      where: { tenantId, groupKey, status: 'FIRING', notifiedAt: IsNull(), dispatchAfter: LessThanOrEqual(now) },
      lock: { mode: 'pessimistic_write' },
    })
    if (due.length === 0) return [] as Alert[]
    const lease = new Date(now.getTime() + LEASE_MS)
    for (const a of due) { a.dispatchAfter = lease }
    await repo.save(due)
    return due
  })
  if (claimed.length === 0) return { announced: 0, incidentId: null, targetFailures: 0 }

  // 2. Which route(s) claimed them, and what the incident policy says.
  const routeIds = [...new Set(claimed.map((a) => a.routeId).filter((x): x is string => !!x))]
  const routes = routeIds.length
    ? await withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.find({ where: { tenantId, routeId: In(routeIds) } }))
    : []
  const targets: RouteTarget[] = routes.flatMap((r) => readRouteTargets(r.targets))
  const override = routes.map((r) => IncidentActionEnum.safeParse(r.incident).data ?? null).find((x) => x !== null) ?? null
  const severity = maxSeverity(claimed.map((a) => a.severity))
  const action = incidentActionFor(await loadPolicy(tenantId), severity, override)

  // 3. The incident. A single monitor's alert keeps tying to that monitor (its one-open-incident rule and its list filter).
  let incidentId: string | null = null
  if (action === 'auto') {
    const first = claimed[0]
    const monitorIds = new Set(claimed.map((a) => a.labels?.monitorId).filter(Boolean))
    const monitorId = first.source === 'monitor' && monitorIds.size === 1 ? [...monitorIds][0] : null
    try {
      const incident = await IncidentService.openIncident(tenantId, {
        monitorId, alertGroupKey: groupKey, title: summarize(claimed).slice(0, 300),
        reason: (first.annotations?.reason ?? first.annotations?.summary ?? first.annotations?.description ?? null)?.slice(0, 1000) ?? null,
        severity: incidentSeverityOf(severity), isAuto: true,
      })
      incidentId = incident.incidentId
      // The timeline says which alerts this incident answers for (the first few; a storm is one line, not a thousand).
      const linked = claimed.slice(0, 20)
      for (const a of linked) await recordIncidentEvent(tenantId, incidentId, 'ALERT_LINKED', { data: { alertId: a.alertId, title: a.title, severity: a.severity } })
      if (claimed.length > linked.length) await recordIncidentEvent(tenantId, incidentId, 'ALERT_LINKED', { data: { title: `and ${claimed.length - linked.length} more alerts`, count: claimed.length - linked.length } })
    } catch (err) {
      // The alerts stay un-announced (the lease lapses) and the next sweep tries again: an incident that could not open is retried, not dropped.
      Logger.error(`[alert.dispatch] incident open failed tenant=${tenantId} group=${groupKey}: ${err instanceof Error ? err.message : String(err)}`)
      return { announced: 0, incidentId: null, targetFailures: 0 }
    }
  }

  // 4. Targets. A failing one becomes an alert of its own instead of a silent drop.
  const results = await runTargets(targets, { tenantId, groupKey, alerts: claimed, incidentId, now })
  let failures = 0
  for (const r of results) {
    if (r.ok) { await clearTargetUnavailable(tenantId, r.type).catch(() => {}); continue }
    failures += 1
    alertMetrics.targetFailures.inc({ type: r.type })
    Logger.warn(`[alert.dispatch] target ${r.type} failed tenant=${tenantId} group=${groupKey}: ${r.reason ?? 'unknown'}`)
    await raiseTargetUnavailable(tenantId, r.type, r.reason ?? 'delivery failed').catch(() => {})
  }

  // 5. Done: announced, with the incident attached.
  await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.update(
    { tenantId, alertId: In(claimed.map((a) => a.alertId)) },
    { notifiedAt: now, dispatchAfter: null, ...(incidentId ? { incidentId } : {}) },
  ))
  alertMetrics.groupsDispatched.inc({ incident: incidentId ? 'opened' : 'none' })
  return { announced: claimed.length, incidentId, targetFailures: failures }
}

/** A recovery of an alert that had been announced: webhook targets hear about it, nobody is paged. */
export async function announceResolved(tenantId: string, alert: Alert): Promise<void> {
  if (!alert.notifiedAt || !alert.routeId) return
  const route = await withTenantRepositoryFor(tenantId, AlertRoute, (repo) => repo.findOne({ where: { tenantId, routeId: alert.routeId as string } }))
  if (!route) return
  const targets = readRouteTargets(route.targets)
  await runResolvedTargets(targets, {
    tenantId, groupKey: alert.groupKey ?? '', alerts: [alert], incidentId: alert.incidentId ?? null, now: new Date(),
  })
  // When the LAST open alert of the group recovers, the page raised for the group is resolved too.
  if (alert.groupKey) {
    const stillOpen = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.count({ where: { tenantId, groupKey: alert.groupKey as string, status: In(OPEN_STATUSES) } }))
    if (stillOpen === 0) await resolveOnCallPages(targets, tenantId, alert.groupKey)
  }
}

/** When the last non-resolved alert of an auto-opened incident recovers, the incident closes itself. */
export async function settleIncident(tenantId: string, incidentId: string): Promise<void> {
  const remaining = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.count({ where: { tenantId, incidentId, status: In(OPEN_STATUSES) } }))
  if (remaining === 0) await IncidentService.resolveAutoById(tenantId, incidentId, 'Recovered')
}

/**
 * One pass for one tenant: release what a silence or a recovered parent was holding back, then announce every group whose wait is over
 * (including groups whose lease lapsed after a crash).
 */
export async function sweepTenant(tenantId: string, now: Date = new Date()): Promise<{ groups: number; announced: number }> {
  const { default: AlertService } = await import('./alert.service')
  // What modules report as firing (`observability:alert-source`) enters the pipeline on the same minutely pass. A failure here must not stop
  // the rest of the sweep: the sources are one input, announcing what is already due is the other.
  try {
    const { syncAlertSources } = await import('./alert.extension-source.service')
    await syncAlertSources(tenantId)
  } catch (err) {
    Logger.warn(`[alert.dispatch] alert-source sync failed tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // SLO burn becomes alerts and budget changes become events on the same pass; like the sources, a failure here must not stop the sweep.
  try {
    const { evaluateTenantSlos } = await import('./slo.service')
    await evaluateTenantSlos(tenantId, undefined, now)
  } catch (err) {
    Logger.warn(`[alert.dispatch] SLO evaluation failed tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // Platform queues (depth, oldest waiting job, failure ratio) are judged on the ROOT tenant's pass; best-effort like the other inputs.
  try {
    const { evaluateQueuesNow } = await import('./queue.health')
    await evaluateQueuesNow(tenantId)
  } catch (err) {
    Logger.warn(`[alert.dispatch] queue health failed tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`)
  }
  // The telemetry stores the platform offers are watched on the same pass (ROOT only): see telemetry/telemetry.store-health.ts.
  try {
    const { evaluateStoresNow } = await import('./telemetry/telemetry.store-health')
    await evaluateStoresNow(tenantId)
  } catch (err) {
    Logger.warn(`[alert.dispatch] telemetry store health failed tenant=${tenantId}: ${err instanceof Error ? err.message : String(err)}`)
  }
  const released = await AlertService.reevaluate(tenantId, now)
  const due = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({
    where: { tenantId, status: 'FIRING', notifiedAt: IsNull(), dispatchAfter: LessThanOrEqual(now) }, take: 2000,
  }))
  const groups = [...new Set(due.map((a) => a.groupKey).filter((x): x is string => !!x))].slice(0, MAX_GROUPS_PER_SWEEP)
  // Alerts a silence or a recovered parent just released are announced by the re-evaluation itself; they count here too.
  let announced = released.announced
  for (const g of groups) announced += (await dispatchGroup(tenantId, g, now)).announced
  return { groups: groups.length, announced }
}
