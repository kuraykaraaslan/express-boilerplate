import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import Logger from '@kuraykaraaslan-labs/logger'
import type { TenantPurgeStep } from '@kuraykaraaslan-labs/tenant/server/tenant.extension-points'
import { MonitorCheck } from './entities/monitor_check.entity'
import { MonitorCheckDetail } from './entities/monitor_check_detail.entity'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { MonitorCheckDailyLocation } from './entities/monitor_check_daily_location.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import { StatusComponent } from './entities/status_component.entity'
import { StatusSubscriber } from './entities/status_subscriber.entity'
import { Monitor } from './entities/monitor.entity'
import { Alert } from './entities/alert.entity'
import { AlertIntegration } from './entities/alert_integration.entity'
import { AlertRoute } from './entities/alert_route.entity'
import { AlertSilence } from './entities/alert_silence.entity'
import { AlertDependency } from './entities/alert_dependency.entity'
import { Slo } from './entities/slo.entity'
import { IncidentEvent } from './entities/incident_event.entity'
import { IncidentParticipant } from './entities/incident_participant.entity'
import { IncidentPostmortem } from './entities/incident_postmortem.entity'
import { IncidentUpdateTemplate } from './entities/incident_update_template.entity'
import { IncidentUpdate } from './entities/incident_update.entity'
import { Incident } from './entities/incident.entity'
import { ProbeLease } from './entities/probe_lease.entity'
import { ProbeEnrolment } from './entities/probe_enrolment.entity'
import { ProbeRunner } from './entities/probe_runner.entity'
import { ProbeLocation } from './entities/probe_location.entity'

/**
 * `tenant:purge_step` — a purged tenant's observability rows are deleted (phase 16.8). Without this, a workspace that was deleted after
 * its grace period still had its monitors (and their targets and headers), subscriber e-mails, alert history and incident records on disk.
 *
 * Children before parents, one table at a time and independently: a table that fails is reported and the rest still go, and the step is
 * idempotent (a second run finds nothing). Telemetry in the external backend is erased by the sibling step, not here.
 */
const TABLES: Array<[string, new () => object]> = [
  ['monitor_check_details', MonitorCheckDetail], ['monitor_checks', MonitorCheck], ['monitor_checks_daily', MonitorCheckDaily], ['monitor_check_daily_location', MonitorCheckDailyLocation],
  ['status_component_monitors', StatusComponentMonitor], ['status_components', StatusComponent], ['status_subscribers', StatusSubscriber],
  ['alerts', Alert], ['alert_integrations', AlertIntegration], ['alert_routes', AlertRoute], ['alert_silences', AlertSilence], ['alert_dependencies', AlertDependency],
  ['slos', Slo],
  ['incident_events', IncidentEvent], ['incident_participants', IncidentParticipant], ['incident_postmortems', IncidentPostmortem],
  ['incident_update_templates', IncidentUpdateTemplate], ['incident_updates', IncidentUpdate], ['incidents', Incident],
  ['probe_leases', ProbeLease], ['probe_enrolments', ProbeEnrolment], ['probe_runners', ProbeRunner], ['probe_locations', ProbeLocation],
  ['monitors', Monitor],
]

export async function purgeObservabilityRows(tenantId: string): Promise<{ failed: string[] }> {
  const failed: string[] = []
  for (const [name, entity] of TABLES) {
    try {
      await withTenantRepositoryFor(tenantId, entity as never, (repo) => (repo as unknown as { delete(w: object): Promise<unknown> }).delete({ tenantId }))
    } catch (err) {
      failed.push(name)
      Logger.warn(`[observability.purge] ${name} for ${tenantId}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  if (failed.length) throw new Error(`observability rows not purged: ${failed.join(', ')}`)
  return { failed }
}

const step: TenantPurgeStep = {
  async purge(tenantId) { await purgeObservabilityRows(tenantId) },
}

export default step
