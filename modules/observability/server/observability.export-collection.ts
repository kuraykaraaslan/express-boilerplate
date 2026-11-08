import 'reflect-metadata'
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db'
import type { ExportCollection, ExportCollectionProvider } from '@kuraykaraaslan-labs/common/server/common.export-contracts'
import { Monitor } from './entities/monitor.entity'
import { MonitorCheckDaily } from './entities/monitor_check_daily.entity'
import { MonitorCheckDailyLocation } from './entities/monitor_check_daily_location.entity'
import { StatusComponent } from './entities/status_component.entity'
import { StatusComponentMonitor } from './entities/status_component_monitor.entity'
import { StatusSubscriber } from './entities/status_subscriber.entity'
import { AlertIntegration } from './entities/alert_integration.entity'
import { AlertRoute } from './entities/alert_route.entity'
import { AlertSilence } from './entities/alert_silence.entity'
import { AlertDependency } from './entities/alert_dependency.entity'
import { Alert } from './entities/alert.entity'
import { Slo } from './entities/slo.entity'
import { Incident } from './entities/incident.entity'
import { IncidentEvent } from './entities/incident_event.entity'
import { IncidentParticipant } from './entities/incident_participant.entity'
import { IncidentPostmortem } from './entities/incident_postmortem.entity'
import { IncidentUpdateTemplate } from './entities/incident_update_template.entity'
import { ProbeLocation } from './entities/probe_location.entity'
import { ProbeRunner } from './entities/probe_runner.entity'
import { ChatDestination } from './entities/chat_destination.entity'

/**
 * `tenant_export:collection` — everything a workspace configured or recorded in observability (phase 16.8), under `observability*` keys.
 *
 * Left out ON PURPOSE: raw probe checks (volume, pruned by retention anyway; the daily rollups stand in for them), and every credential. A
 * monitor's sealed `secrets` are ciphertext that only this deployment's key opens, so they would be useless elsewhere and are a liability here;
 * heartbeat token hashes, alert-ingest key hashes, probe-runner enrolment tokens (not exported at all) and runner public keys likewise. The export names a monitor's secrets (`secretNames`) so the owner knows what to
 * re-enter. Alerts are capped to the newest ones: a flapping alert source must not make the export unbounded.
 */
const MAX_ALERTS = 5000
const MAX_EVENTS = 20_000
const MAX_ROLLUPS = 50_000

type Finder = { find(o: object): Promise<Record<string, unknown>[]> }
const find = <T extends object>(tenantId: string, entity: new () => T, opts: Record<string, unknown> = {}) =>
  withTenantRepositoryFor(tenantId, entity as never, (repo) => (repo as unknown as Finder).find({ where: { tenantId }, ...opts }))

function monitorView(m: Record<string, unknown>): Record<string, unknown> {
  const { secrets, heartbeatTokenHash, ...rest } = m
  return { ...rest, secretNames: secrets && typeof secrets === 'object' ? Object.keys(secrets as object) : [] }
}
function withoutKeys(rows: Record<string, unknown>[], ...keys: string[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !keys.includes(k))))
}

const provider: ExportCollectionProvider = async (tenantId: string): Promise<ExportCollection[]> => {
  const [
    monitors, rollups, locationRollups, components, componentMonitors, subscribers, integrations, routes, silences, dependencies, alerts, slos,
    incidents, events, participants, postmortems, templates, probeLocations, probeRunners, chatDestinations,
  ] = await Promise.all([
    find(tenantId, Monitor, { order: { createdAt: 'ASC' } }),
    find(tenantId, MonitorCheckDaily, { order: { day: 'DESC' }, take: MAX_ROLLUPS }),
    find(tenantId, MonitorCheckDailyLocation, { order: { day: 'DESC' }, take: MAX_ROLLUPS }),
    find(tenantId, StatusComponent), find(tenantId, StatusComponentMonitor), find(tenantId, StatusSubscriber),
    find(tenantId, AlertIntegration), find(tenantId, AlertRoute, { order: { position: 'ASC' } }), find(tenantId, AlertSilence), find(tenantId, AlertDependency),
    find(tenantId, Alert, { order: { lastFiredAt: 'DESC' }, take: MAX_ALERTS }),
    find(tenantId, Slo),
    find(tenantId, Incident, { order: { createdAt: 'DESC' } }),
    find(tenantId, IncidentEvent, { order: { createdAt: 'DESC' }, take: MAX_EVENTS }),
    find(tenantId, IncidentParticipant), find(tenantId, IncidentPostmortem), find(tenantId, IncidentUpdateTemplate),
    find(tenantId, ProbeLocation), find(tenantId, ProbeRunner), find(tenantId, ChatDestination),
  ])
  return [
    { key: 'observabilityMonitors', label: 'Uptime monitors', rows: monitors.map(monitorView) },
    { key: 'observabilityUptimeDaily', label: 'Uptime daily rollups', rows: rollups },
    { key: 'observabilityUptimeDailyByLocation', label: 'Uptime daily rollups per probe location (from the day they started; earlier history is monitor-level only)', rows: locationRollups },
    { key: 'observabilityStatusComponents', label: 'Status page components', rows: components },
    { key: 'observabilityStatusComponentMonitors', label: 'Status component to monitor links', rows: componentMonitors },
    { key: 'observabilityStatusSubscribers', label: 'Status page subscribers', rows: withoutKeys(subscribers, 'verifyToken', 'unsubscribeToken', 'chatUrlCipher', 'chatUrlFingerprint') },
    { key: 'observabilityAlertIntegrations', label: 'Alert ingest keys (the key itself is not exported)', rows: withoutKeys(integrations, 'keyHash') },
    { key: 'observabilityAlertRoutes', label: 'Alert routes', rows: routes },
    { key: 'observabilityAlertSilences', label: 'Alert silences', rows: silences },
    { key: 'observabilityAlertDependencies', label: 'Alert dependency graph', rows: dependencies },
    { key: 'observabilityAlerts', label: `Alerts (newest ${MAX_ALERTS})`, rows: alerts },
    { key: 'observabilitySlos', label: 'Service level objectives', rows: slos },
    { key: 'observabilityIncidents', label: 'Incidents', rows: incidents },
    { key: 'observabilityIncidentEvents', label: `Incident timeline (newest ${MAX_EVENTS})`, rows: events },
    { key: 'observabilityIncidentParticipants', label: 'Incident roles', rows: participants },
    { key: 'observabilityIncidentPostmortems', label: 'Post-mortems', rows: postmortems },
    { key: 'observabilityIncidentTemplates', label: 'Incident update templates', rows: templates },
    { key: 'observabilityProbeLocations', label: 'Probe locations (private ones, with their target allow-lists)', rows: probeLocations },
    { key: 'observabilityChatDestinations', label: 'Slack and Teams destinations (host and settings only; the webhook URL is a credential and is not exported)', rows: withoutKeys(chatDestinations, 'urlCipher', 'urlFingerprint') },
    { key: 'observabilityProbeRunners', label: 'Probe runners (fingerprint only; the public key is not exported)', rows: withoutKeys(probeRunners, 'publicKeyPem') },
  ]
}

export default provider
