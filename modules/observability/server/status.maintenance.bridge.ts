import 'reflect-metadata'
import Logger from '@kuraykaraaslan-labs/logger'

/**
 * The maintenance bridge (tenant phase 3 / observability phase 2.3 [~]):
 * observability RENDERS maintenance windows, it does not OWN them. The single
 * source is `tenant`'s MaintenanceWindow — this file is a read seam plus a
 * listener registration, and deliberately holds NO table (the audit's rule 2:
 * the same data model is never redefined; grep this module for
 * MaintenanceWindow entities and find none).
 *
 * Both directions are dynamic import()s recorded in ACCEPTED_FORWARD_DRIFT
 * (`observability->tenant`): observability requires only env+logger by
 * design, and a status page must keep serving on a deployment where the
 * tenancy module is absent — the maintenance block is simply empty.
 */

export interface BridgedMaintenanceWindow {
  windowId: string
  title: string
  message: string | null
  scope: string
  mode: string
  scheduledStart: Date
  scheduledEnd: Date | null
  active: boolean
}

interface CandidateWindow {
  windowId: string
  title: string
  message: string | null
  scope: string
  mode: string
  status: string
  scheduledStart: Date | string
  scheduledEnd: Date | string | null
}

function isActive(w: CandidateWindow, now: Date): boolean {
  if (w.status === 'IN_PROGRESS') return true
  const start = new Date(w.scheduledStart)
  if (start > now) return false
  return !w.scheduledEnd || new Date(w.scheduledEnd) > now
}

/**
 * Allowlisted public projection of the windows concerning `tenantId` —
 * active first, then upcoming. Route patterns and allowRoles are OMITTED on
 * purpose (locked decision: internal paths never reach the public page).
 */
export async function listMaintenanceForStatus(tenantId: string): Promise<{
  active: BridgedMaintenanceWindow[]
  upcoming: BridgedMaintenanceWindow[]
}> {
  try {
    const { default: MaintenanceService } = await import('@kuraykaraaslan-labs/tenant/server/maintenance.service')
    const candidates: CandidateWindow[] = await MaintenanceService.candidatesFor(tenantId)
    const now = new Date()
    const toPublic = (w: CandidateWindow, active: boolean): BridgedMaintenanceWindow => ({
      windowId: w.windowId,
      title: w.title,
      message: w.message ?? null,
      scope: w.scope,
      mode: w.mode,
      scheduledStart: new Date(w.scheduledStart),
      scheduledEnd: w.scheduledEnd ? new Date(w.scheduledEnd) : null,
      active,
    })
    return {
      active: candidates.filter((w) => isActive(w, now)).map((w) => toPublic(w, true)),
      upcoming: candidates
        .filter((w) => w.status === 'SCHEDULED' && new Date(w.scheduledStart) > now)
        .sort((a, b) => new Date(a.scheduledStart).getTime() - new Date(b.scheduledStart).getTime())
        .map((w) => toPublic(w, false)),
    }
  } catch (err) {
    Logger.warn(`[observability] maintenance bridge read failed (empty): ${err instanceof Error ? err.message : String(err)}`)
    return { active: [], upcoming: [] }
  }
}

/**
 * Is a FULL-freeze (non-ROUTE) window active for this tenant right now?
 * The probe path asks this before opening an auto incident — an expected
 * outage must not page anybody. Fails CLOSED to `false`: when the answer is
 * unknowable the incident still opens, because a lost alarm costs more than
 * a redundant one.
 */
export async function maintenanceActive(tenantId: string): Promise<boolean> {
  try {
    const { default: MaintenanceService } = await import('@kuraykaraaslan-labs/tenant/server/maintenance.service')
    const candidates: CandidateWindow[] = await MaintenanceService.candidatesFor(tenantId)
    const now = new Date()
    return candidates.some((w) => w.scope !== 'ROUTE' && isActive(w, now))
  } catch {
    return false
  }
}

let _registered = false

/**
 * Boot-time listener registration (instrumentation.ts, beside the approval
 * handlers): a maintenance transition in `tenant` refreshes the live status
 * page and — on start/end — mails the status subscribers. SYSTEM windows
 * (tenantId=null) have no single tenant to fan out to; they skip with a log
 * and surface through each page's maintenance block instead.
 */
export async function registerMaintenanceStatusBridge(): Promise<void> {
  if (_registered) return
  _registered = true
  const { registerMaintenanceListener } = await import('@kuraykaraaslan-labs/tenant/server/maintenance.events')
  registerMaintenanceListener(async (event, window) => {
    if (!window.tenantId) {
      Logger.info(`[observability] system maintenance '${event}' (${window.windowId}) — shown per status page, no subscriber fan-out`)
      return
    }
    const tenantId = window.tenantId
    const { publishStatusChanged } = await import('./status.realtime')
    void publishStatusChanged(tenantId)
    if (event === 'started' || event === 'ended') {
      const { default: StatusSubscriberService } = await import('./status.subscriber.service')
      void StatusSubscriberService.notifyMaintenance(tenantId, window, event)
    }
  })
  Logger.info('[observability] maintenance status bridge registered')
}
