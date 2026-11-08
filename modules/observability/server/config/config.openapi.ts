import { z } from 'zod'
import { CreateMonitorDTO, UpdateMonitorDTO, BulkMonitorDTO, ImportMonitorsDTO, CreateStatusComponentDTO, UpdateStatusComponentDTO, UpdateIncidentDTO, AddIncidentUpdateDTO } from '../uptime.dto'
import { ManualAlertDTO, CreateIntegrationDTO, UpdateIntegrationDTO, CreateRouteDTO, UpdateRouteDTO, SimulateRouteDTO, CreateSilenceDTO, CreateDependencyDTO } from '../alert.dto'
import { CreateSloDTO, UpdateSloDTO, ImportOpenSloDTO } from '../slo.dto'
import { UpsertTemplateDTO, RenderTemplateDTO, AssignRoleDTO, NoteDTO, TaskDTO, ReviewDTO } from '../incident.dto'
import { CreateChatDestinationDTO, UpdateChatDestinationDTO } from '../chat.dto'
import { ConfigRequestDTO, DetachDTO, ObservabilityConfigDTO, CONFIG_SCHEMA_ID } from './config.dto'
import { CONFIG_SCOPE_READ, CONFIG_SCOPE_WRITE } from './config.kinds'
import { OPS_SCOPES } from '../ops/ops.scopes'

/**
 * The OpenAPI 3.1 document of the observability REST surface (observability phase 21.2), generated from the DTOs the routes validate with.
 *
 * A table of operations (below) names every documented route, its method, its guard and the DTO of its body. A test reads the real route files
 * and fails when the table and the routes disagree (a new route without a row, a changed permission, a removed method), so the document cannot
 * drift from the code the way a hand-written one does. Bodies and the configuration schema are `z.toJSONSchema` of the live DTOs.
 *
 * Versioning policy (also in the module README): the API is versioned by CONTRACT, not by URL. `x-api-version` is the major version of this
 * document; additive changes (a new route, a new optional field, a new enum value on a response) keep it, and a breaking change (a removed or
 * renamed field, a tightened validation, a changed meaning) ships as a new document and a new configuration schema id (`roltek-observability-2`)
 * while the previous one keeps working for at least two minor releases of the platform. The configuration schema id is the version a file
 * declares in `schema:`, so a file always says which contract it was written against.
 */

export const OPENAPI_VERSION_MAJOR = '1'
export const OPENAPI_DOC_ID = 'roltek-observability-openapi-1'

/** Who may call: a console session holding the permission; a session or an api key (`config`); nobody in particular (`public`, `token`). */
type Access = 'session' | 'config' | 'ops' | 'public' | 'token'
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Operation {
  method: Method
  path: string
  tag: string
  summary: string
  access: Access
  /** Permissions asked by the route, as in the source (session routes). */
  permissions?: string[]
  /** `config` routes: the key scope for a read and a write. */
  body?: keyof typeof BODIES
  /** Query parameters (all optional unless `required`), documented as `in: query`. */
  query?: Array<{ name: string; description: string; schema: Record<string, unknown>; required?: boolean }>
  /** Media types of a successful answer when it is not JSON. */
  produces?: string[]
  /** `ops` routes: the one api-key scope that grants the action (exact; `admin` does not). The session lane keeps `permissions`. */
  scope?: string
}

const SLA_QUERY = [
  { name: 'from', description: 'First UTC day of the period, YYYY-MM-DD (inclusive). Default: the length of the default period before `to`.', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  { name: 'to', description: 'Last UTC day of the period, YYYY-MM-DD (inclusive). Default: today. A period covers at most 92 days and starts at most 366 days back.', schema: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
  { name: 'format', description: 'json (default), csv or pdf. csv and pdf are attachments.', schema: { type: 'string', enum: ['json', 'csv', 'pdf'], default: 'json' } },
]

const BODIES = {
  CreateMonitor: CreateMonitorDTO, UpdateMonitor: UpdateMonitorDTO, BulkMonitor: BulkMonitorDTO, ImportMonitors: ImportMonitorsDTO,
  CreateStatusComponent: CreateStatusComponentDTO, UpdateStatusComponent: UpdateStatusComponentDTO, UpdateIncident: UpdateIncidentDTO, AddIncidentUpdate: AddIncidentUpdateDTO,
  ManualAlert: ManualAlertDTO, CreateIntegration: CreateIntegrationDTO, UpdateIntegration: UpdateIntegrationDTO, CreateRoute: CreateRouteDTO, UpdateRoute: UpdateRouteDTO,
  SimulateRoute: SimulateRouteDTO, CreateSilence: CreateSilenceDTO, CreateDependency: CreateDependencyDTO, CreateSlo: CreateSloDTO, UpdateSlo: UpdateSloDTO,
  ImportOpenSlo: ImportOpenSloDTO, UpsertTemplate: UpsertTemplateDTO, RenderTemplate: RenderTemplateDTO, AssignRole: AssignRoleDTO, Note: NoteDTO, Task: TaskDTO,
  Review: ReviewDTO, CreateChatDestination: CreateChatDestinationDTO, UpdateChatDestination: UpdateChatDestinationDTO, ConfigRequest: ConfigRequestDTO, Detach: DetachDTO,
} as const

const S = 'session' as const
const m = (p: string) => [`observability.${p}`]
const MR = m('monitors.read'), MM = m('monitors.manage'), AR = m('alerts.read'), AM = m('alerts.manage'), SR = m('slos.read'), SM = m('slos.manage')
const IR = m('incidents.read'), IM = m('incidents.manage')

/** The documented routes. Cron twins, platform operator routes (processes, slo, extensions, health) and the OTLP ingest endpoints are documented elsewhere (see EXCLUDED_FROM_OPENAPI). */
export const OPERATIONS: Operation[] = [
  { method: 'GET', path: '/api/monitors', tag: 'Monitors', summary: 'List monitors', access: S, permissions: MR },
  { method: 'POST', path: '/api/monitors', tag: 'Monitors', summary: 'Create a monitor (a heartbeat token is returned once)', access: S, permissions: MM, body: 'CreateMonitor' },
  { method: 'GET', path: '/api/monitors/[monitorId]', tag: 'Monitors', summary: 'One monitor (secrets and header values are never returned)', access: S, permissions: MR },
  { method: 'PATCH', path: '/api/monitors/[monitorId]', tag: 'Monitors', summary: 'Edit a monitor', access: S, permissions: MM, body: 'UpdateMonitor' },
  { method: 'DELETE', path: '/api/monitors/[monitorId]', tag: 'Monitors', summary: 'Delete a monitor', access: S, permissions: MM },
  { method: 'POST', path: '/api/monitors/[monitorId]/check', tag: 'Monitors', summary: 'Probe now', access: S, permissions: MM },
  { method: 'GET', path: '/api/monitors/[monitorId]/checks', tag: 'Monitors', summary: 'Recent samples', access: S, permissions: MR },
  { method: 'GET', path: '/api/monitors/[monitorId]/checks/[checkId]/screenshot', tag: 'Monitors', summary: 'The JPEG a browser check took at the step that failed (its own permission)', access: S, permissions: m('screenshots.read') },
  { method: 'GET', path: '/api/monitors/[monitorId]/uptime', tag: 'Monitors', summary: 'Uptime over a window', access: S, permissions: MR },
  { method: 'POST', path: '/api/monitors/[monitorId]/clone', tag: 'Monitors', summary: 'Clone a monitor', access: S, permissions: MM },
  { method: 'POST', path: '/api/monitors/[monitorId]/heartbeat-token', tag: 'Monitors', summary: 'Rotate a heartbeat token (returned once)', access: S, permissions: MM },
  { method: 'POST', path: '/api/monitors/bulk', tag: 'Monitors', summary: 'Pause, resume, delete or put in maintenance many monitors', access: S, permissions: MM, body: 'BulkMonitor' },
  { method: 'POST', path: '/api/monitors/import', tag: 'Monitors', summary: 'Import monitors from CSV, YAML or JSON (dry run by default)', access: S, permissions: MM, body: 'ImportMonitors' },
  { method: 'GET', path: '/api/status-components', tag: 'Status', summary: 'List status components', access: S, permissions: MR },
  { method: 'POST', path: '/api/status-components', tag: 'Status', summary: 'Create a status component', access: S, permissions: MM, body: 'CreateStatusComponent' },
  { method: 'GET', path: '/api/status-components/[componentId]', tag: 'Status', summary: 'One component with its uptime windows', access: S, permissions: MR },
  { method: 'PATCH', path: '/api/status-components/[componentId]', tag: 'Status', summary: 'Edit a component', access: S, permissions: MM, body: 'UpdateStatusComponent' },
  { method: 'DELETE', path: '/api/status-components/[componentId]', tag: 'Status', summary: 'Delete a component', access: S, permissions: MM },
  { method: 'GET', path: '/api/status-pages/[pageId]/sla-report', tag: 'Status', summary: 'The uptime report of the components a status page shows, over a period, as JSON, CSV or PDF (planned maintenance left out as the page leaves it out)', access: S, permissions: m('status.read'),
    query: [...SLA_QUERY, { name: 'objective', description: 'An uptime target, in percent (above 50, below 100), to judge every row against.', schema: { type: 'number', exclusiveMinimum: 50, exclusiveMaximum: 100 } }], produces: ['application/json', 'text/csv', 'application/pdf'] },
  { method: 'GET', path: '/api/status-subscribers', tag: 'Status', summary: 'List status page subscribers (tokens are never returned)', access: S, permissions: m('status.read') }, // observability.04: the subscriber list is status-page data
  { method: 'GET', path: '/api/public/status', tag: 'Status', summary: 'The public status page data', access: 'public' },
  { method: 'POST', path: '/api/public/status/subscribe', tag: 'Status', summary: 'Subscribe (double opt-in)', access: 'public' },
  { method: 'GET', path: '/api/public/status/verify', tag: 'Status', summary: 'Confirm a subscription (a Slack or Teams subscriber only gets a confirmation button here: a link preview must not confirm)', access: 'token' },
  { method: 'POST', path: '/api/public/status/verify', tag: 'Status', summary: 'The confirmation button of a Slack or Teams subscriber', access: 'token' },
  { method: 'GET', path: '/api/public/status/unsubscribe', tag: 'Status', summary: 'Unsubscribe (a Slack or Teams subscriber only gets a confirmation button here)', access: 'token' },
  { method: 'POST', path: '/api/public/status/unsubscribe', tag: 'Status', summary: 'The unsubscribe button of a Slack or Teams subscriber', access: 'token' },
  { method: 'GET', path: '/api/chat-destinations', tag: 'Chat', summary: 'List the Slack and Teams destinations of incidents (masked: the webhook URL is never returned)', access: S, permissions: IR },
  { method: 'POST', path: '/api/chat-destinations', tag: 'Chat', summary: 'Connect a Slack or Teams incoming webhook (the URL is write-only, checked against the vendors hosts and stored encrypted)', access: S, permissions: m('chat.manage'), body: 'CreateChatDestination' },
  { method: 'PATCH', path: '/api/chat-destinations/[destinationId]', tag: 'Chat', summary: 'Edit a destination (a new url rotates the webhook)', access: S, permissions: m('chat.manage'), body: 'UpdateChatDestination' },
  { method: 'DELETE', path: '/api/chat-destinations/[destinationId]', tag: 'Chat', summary: 'Remove a destination', access: S, permissions: m('chat.manage') },
  { method: 'POST', path: '/api/chat-destinations/[destinationId]/test', tag: 'Chat', summary: 'Post one fixed test message to a destination (strictest rate bucket, per-destination cooldown)', access: S, permissions: m('chat.manage') },
  { method: 'GET', path: '/api/public/heartbeat/[token]', tag: 'Heartbeat', summary: 'A job checked in', access: 'token' },
  { method: 'POST', path: '/api/public/heartbeat/[token]', tag: 'Heartbeat', summary: 'A job checked in', access: 'token' },
  { method: 'GET', path: '/api/public/heartbeat/[token]/start', tag: 'Heartbeat', summary: 'A job started', access: 'token' },
  { method: 'POST', path: '/api/public/heartbeat/[token]/start', tag: 'Heartbeat', summary: 'A job started', access: 'token' },
  { method: 'GET', path: '/api/public/heartbeat/[token]/fail', tag: 'Heartbeat', summary: 'A job failed', access: 'token' },
  { method: 'POST', path: '/api/public/heartbeat/[token]/fail', tag: 'Heartbeat', summary: 'A job failed', access: 'token' },
  { method: 'GET', path: '/api/alerts', tag: 'Alerts', summary: 'List alerts', access: S, permissions: AR },
  { method: 'POST', path: '/api/alerts', tag: 'Alerts', summary: 'Raise an alert by hand', access: S, permissions: AM, body: 'ManualAlert' },
  { method: 'GET', path: '/api/alerts/[alertId]', tag: 'Alerts', summary: 'One alert', access: S, permissions: AR },
  { method: 'POST', path: '/api/alerts/[alertId]/ack', tag: 'Alerts', summary: 'Acknowledge an alert (a console session, or an api key with observability_ops:ack)', access: 'ops', permissions: AM, scope: OPS_SCOPES.ack },
  { method: 'POST', path: '/api/alerts/[alertId]/resolve', tag: 'Alerts', summary: 'Resolve an alert', access: S, permissions: AM },
  { method: 'GET', path: '/api/alerts/[alertId]/changes', tag: 'Alerts', summary: 'What changed around the alert', access: S, permissions: AR },
  { method: 'POST', path: '/api/public/alerts/ingest/[key]', tag: 'Alerts', summary: 'Send alerts with an ingest key (generic, Alertmanager or Grafana payloads)', access: 'token' },
  { method: 'GET', path: '/api/alert-integrations', tag: 'Alerts', summary: 'List ingest integrations (keys are never returned)', access: S, permissions: AR },
  { method: 'POST', path: '/api/alert-integrations', tag: 'Alerts', summary: 'Create an ingest integration (the key is returned once)', access: S, permissions: AM, body: 'CreateIntegration' },
  { method: 'PATCH', path: '/api/alert-integrations/[integrationId]', tag: 'Alerts', summary: 'Edit an integration', access: S, permissions: AM, body: 'UpdateIntegration' },
  { method: 'DELETE', path: '/api/alert-integrations/[integrationId]', tag: 'Alerts', summary: 'Delete an integration', access: S, permissions: AM },
  { method: 'POST', path: '/api/alert-integrations/[integrationId]/rotate', tag: 'Alerts', summary: 'Rotate an ingest key (returned once)', access: S, permissions: AM },
  { method: 'GET', path: '/api/alert-routes', tag: 'Alerts', summary: 'List routing rules', access: S, permissions: AR },
  { method: 'POST', path: '/api/alert-routes', tag: 'Alerts', summary: 'Create a routing rule', access: S, permissions: AM, body: 'CreateRoute' },
  { method: 'POST', path: '/api/alert-routes/simulate', tag: 'Alerts', summary: 'Where would an alert with these labels go?', access: S, permissions: AR, body: 'SimulateRoute' },
  { method: 'PATCH', path: '/api/alert-routes/[routeId]', tag: 'Alerts', summary: 'Edit a routing rule', access: S, permissions: AM, body: 'UpdateRoute' },
  { method: 'DELETE', path: '/api/alert-routes/[routeId]', tag: 'Alerts', summary: 'Delete a routing rule', access: S, permissions: AM },
  { method: 'GET', path: '/api/alert-silences', tag: 'Alerts', summary: 'List silences', access: S, permissions: AR },
  { method: 'POST', path: '/api/alert-silences', tag: 'Alerts', summary: 'Create a silence', access: S, permissions: AM, body: 'CreateSilence' },
  { method: 'DELETE', path: '/api/alert-silences/[silenceId]', tag: 'Alerts', summary: 'End a silence now', access: S, permissions: AM },
  { method: 'GET', path: '/api/alert-silence-templates', tag: 'Alerts', summary: 'List silence templates', access: S, permissions: AR },
  { method: 'POST', path: '/api/alert-silence-templates', tag: 'Alerts', summary: 'Start a silence template (creates a normal silence; a console session, or an api key with observability_ops:silence)', access: 'ops', permissions: AM, scope: OPS_SCOPES.silence },
  { method: 'GET', path: '/api/alert-dependencies', tag: 'Alerts', summary: 'List dependencies', access: S, permissions: AR },
  { method: 'POST', path: '/api/alert-dependencies', tag: 'Alerts', summary: 'Create a dependency', access: S, permissions: AM, body: 'CreateDependency' },
  { method: 'DELETE', path: '/api/alert-dependencies/[dependencyId]', tag: 'Alerts', summary: 'Delete a dependency', access: S, permissions: AM },
  { method: 'GET', path: '/api/slos', tag: 'SLOs', summary: 'List SLOs with their budgets', access: S, permissions: SR },
  { method: 'POST', path: '/api/slos', tag: 'SLOs', summary: 'Create an SLO', access: S, permissions: SM, body: 'CreateSlo' },
  { method: 'GET', path: '/api/slos/openslo', tag: 'SLOs', summary: 'Export SLOs as OpenSLO v1', access: S, permissions: SR },
  { method: 'POST', path: '/api/slos/openslo', tag: 'SLOs', summary: 'Import OpenSLO v1 documents (dry run by default)', access: S, permissions: SM, body: 'ImportOpenSlo' },
  { method: 'GET', path: '/api/slos/[sloId]', tag: 'SLOs', summary: 'One SLO with its report', access: S, permissions: SR },
  { method: 'PATCH', path: '/api/slos/[sloId]', tag: 'SLOs', summary: 'Edit an SLO', access: S, permissions: SM, body: 'UpdateSlo' },
  { method: 'DELETE', path: '/api/slos/[sloId]', tag: 'SLOs', summary: 'Delete an SLO', access: S, permissions: SM },
  { method: 'GET', path: '/api/slos/[sloId]/burn', tag: 'SLOs', summary: 'The burn-rate and error-budget series of an SLO over its window (for the burn chart), with the current burn of every alert tier', access: S, permissions: SR,
    query: [{ name: 'points', description: 'The most points the series may have (2 to 200, default 120). Each point says its resolution (day, hour or merged) and its source (rollup or raw); a point with no events has a null burn, never 0.', schema: { type: 'integer', minimum: 2, maximum: 200, default: 120 } }] },
  { method: 'GET', path: '/api/slos/[sloId]/sla-report', tag: 'SLOs', summary: 'The uptime report of an availability SLO over a period, as JSON, CSV or PDF (planned maintenance left out as the status page leaves it out)', access: S, permissions: SR, query: SLA_QUERY, produces: ['application/json', 'text/csv', 'application/pdf'] },
  { method: 'GET', path: '/api/incidents', tag: 'Incidents', summary: 'List incidents', access: S, permissions: MR },
  { method: 'POST', path: '/api/incidents', tag: 'Incidents', summary: 'Declare an incident (a console session, or an api key with observability_ops:incident)', access: 'ops', permissions: IM, scope: OPS_SCOPES.incident },
  { method: 'GET', path: '/api/incidents/[incidentId]', tag: 'Incidents', summary: 'One incident', access: S, permissions: IR },
  { method: 'PATCH', path: '/api/incidents/[incidentId]', tag: 'Incidents', summary: 'Edit the public face of an incident', access: S, permissions: ['observability.status.publish', ...IM], body: 'UpdateIncident' },
  { method: 'POST', path: '/api/incidents/[incidentId]/resolve', tag: 'Incidents', summary: 'Resolve an incident', access: S, permissions: IM },
  { method: 'POST', path: '/api/incidents/[incidentId]/ack', tag: 'Incidents', summary: 'Acknowledge an incident', access: S, permissions: IM },
  { method: 'POST', path: '/api/incidents/[incidentId]/mitigate', tag: 'Incidents', summary: 'Mark the impact as stopped', access: S, permissions: IM },
  { method: 'GET', path: '/api/incidents/[incidentId]/updates', tag: 'Incidents', summary: 'Public progress updates', access: S, permissions: MR },
  { method: 'POST', path: '/api/incidents/[incidentId]/updates', tag: 'Incidents', summary: 'Post a public progress update', access: S, permissions: IM, body: 'AddIncidentUpdate' },
  { method: 'GET', path: '/api/incidents/[incidentId]/events', tag: 'Incidents', summary: 'The timeline', access: S, permissions: IR },
  { method: 'GET', path: '/api/incidents/[incidentId]/participants', tag: 'Incidents', summary: 'Who is on the incident', access: S, permissions: IR },
  { method: 'PUT', path: '/api/incidents/[incidentId]/participants', tag: 'Incidents', summary: 'Assign a role', access: S, permissions: IM, body: 'AssignRole' },
  { method: 'DELETE', path: '/api/incidents/[incidentId]/participants', tag: 'Incidents', summary: 'Remove a participant', access: S, permissions: IM },
  { method: 'GET', path: '/api/incidents/[incidentId]/notes', tag: 'Incidents', summary: 'Notes', access: S, permissions: IR },
  { method: 'POST', path: '/api/incidents/[incidentId]/notes', tag: 'Incidents', summary: 'Add a note (a console session, or an api key with observability_ops:note)', access: 'ops', permissions: IM, body: 'Note', scope: OPS_SCOPES.note },
  { method: 'GET', path: '/api/incidents/[incidentId]/tasks', tag: 'Incidents', summary: 'Follow-ups', access: S, permissions: IR },
  { method: 'POST', path: '/api/incidents/[incidentId]/tasks', tag: 'Incidents', summary: 'Add a follow-up', access: S, permissions: IM, body: 'Task' },
  { method: 'GET', path: '/api/incidents/[incidentId]/changes', tag: 'Incidents', summary: 'What changed around the incident', access: S, permissions: IR },
  { method: 'GET', path: '/api/incidents/[incidentId]/postmortem', tag: 'Incidents', summary: 'The post-mortem', access: S, permissions: IR },
  { method: 'POST', path: '/api/incidents/[incidentId]/postmortem', tag: 'Incidents', summary: 'Start a post-mortem draft', access: S, permissions: IM },
  { method: 'PATCH', path: '/api/incidents/[incidentId]/postmortem', tag: 'Incidents', summary: 'Edit the post-mortem', access: S, permissions: IM },
  { method: 'POST', path: '/api/incidents/[incidentId]/postmortem/review', tag: 'Incidents', summary: 'Send for review', access: S, permissions: IM, body: 'Review' },
  { method: 'POST', path: '/api/incidents/[incidentId]/postmortem/publish', tag: 'Incidents', summary: 'Publish a reviewed post-mortem', access: S, permissions: m('status.publish') },
  { method: 'POST', path: '/api/incidents/[incidentId]/postmortem/withdraw', tag: 'Incidents', summary: 'Withdraw to a draft', access: S, permissions: IM },
  { method: 'GET', path: '/api/incident-templates', tag: 'Incidents', summary: 'Public update wording', access: S, permissions: IR },
  { method: 'PUT', path: '/api/incident-templates', tag: 'Incidents', summary: 'Set the wording of a status in a locale', access: S, permissions: IM, body: 'UpsertTemplate' },
  { method: 'POST', path: '/api/incident-templates/render', tag: 'Incidents', summary: 'Render a template', access: S, permissions: IR, body: 'RenderTemplate' },
  { method: 'DELETE', path: '/api/incident-templates/[templateId]', tag: 'Incidents', summary: 'Remove an override', access: S, permissions: IM },
  { method: 'GET', path: '/api/incident-analytics', tag: 'Incidents', summary: 'Response metrics', access: S, permissions: IR },
  { method: 'GET', path: '/api/observability/config', tag: 'Configuration', summary: 'Export the live state as a roltek-observability-1 document', access: 'config' },
  { method: 'POST', path: '/api/observability/config/plan', tag: 'Configuration', summary: 'What would this document change? (writes nothing)', access: 'config', body: 'ConfigRequest' },
  { method: 'POST', path: '/api/observability/config/apply', tag: 'Configuration', summary: 'Apply a document (idempotent)', access: 'config', body: 'ConfigRequest' },
  { method: 'GET', path: '/api/observability/config/managed', tag: 'Configuration', summary: 'The code-managed resources', access: 'config' },
  { method: 'POST', path: '/api/observability/config/detach', tag: 'Configuration', summary: 'Hand a code-managed resource to the console', access: 'config', body: 'Detach' },
  { method: 'GET', path: '/api/observability/openapi', tag: 'Configuration', summary: 'This document', access: 'config' },
]

/** Routes deliberately not in the document, with the reason (a test checks that every route is in one list or the other). */
export const EXCLUDED_FROM_OPENAPI: Record<string, string> = {
  '/api/health': 'platform health probe, not a tenant API',
  '/api/processes': 'ROOT workspace operator view',
  '/api/slo': 'ROOT workspace operator view (this process request percentiles)',
  '/api/extensions/breakers': 'ROOT workspace operator view',
  '/api/extensions/client-errors': 'browser error beacon of the console',
  '/api/cron/uptime-probe': 'cron twin (CRON_SECRET)',
  '/api/cron/uptime-retention': 'cron twin (CRON_SECRET)',
  '/api/cron/metering-reconcile': 'cron twin (CRON_SECRET)',
  '/api/incidents/[incidentId]/legal-hold': 'legal hold on an incident (phase 16.4), documented in the module README; not yet in the operation table',
  '/api/cron/process-check': 'cron twin (CRON_SECRET)',
  '/api/cron/alert-dispatch': 'cron twin (CRON_SECRET)',
  '/api/telemetry/otlp/v1/traces': 'OTLP/HTTP, specified by OpenTelemetry (see server/telemetry/README.md)',
  '/api/telemetry/otlp/v1/logs': 'OTLP/HTTP, specified by OpenTelemetry (see server/telemetry/README.md)',
  '/api/telemetry/otlp/v1/metrics': 'OTLP/HTTP, specified by OpenTelemetry (see server/telemetry/README.md)',
  '/api/telemetry/query/logs': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/query/traces': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/query/traces/[traceId]': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/query/metrics': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/query/service-map': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/query/raw': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/correlate': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/saved-queries': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/saved-queries/[queryId]': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/saved-panels': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/saved-panels/[panelId]': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/query/compare': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/compare/settings': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/query/release-health': 'telemetry query API, documented in server/telemetry/README.md',
  '/api/telemetry/browser-keys': 'browser SDK recipe, documented in server/telemetry/BROWSER.md',
  '/api/telemetry/web-vitals': 'the browser snippet as a static script, documented in server/telemetry/BROWSER.md',
  '/api/telemetry/tail-ticket': 'handshake ticket for the live-tail websocket namespace, documented in server/telemetry/README.md',
  '/api/processes/scaling': 'ROOT workspace operator view (process supervisors)',
  '/api/observability/usage': 'ROOT workspace operator view (consumption per workspace)',
  '/api/cron/watchdog': 'cron twin (CRON_SECRET)',
  '/api/probe-locations': 'probe locations admin API (phase 10), documented in the module README; not yet in the operation table',
  '/api/probe-locations/[locationId]': 'probe locations admin API (phase 10), documented in the module README; not yet in the operation table',
  '/api/probe-locations/[locationId]/enrolments': 'probe locations admin API (phase 10), documented in the module README; not yet in the operation table',
  '/api/probe-locations/[locationId]/runners': 'probe locations admin API (phase 10), documented in the module README; not yet in the operation table',
  '/api/probe-runners/[runnerId]': 'probe locations admin API (phase 10), documented in the module README; not yet in the operation table',
  '/api/monitors/[monitorId]/locations': 'per-location uptime of a monitor (phase 10), documented in the module README; not yet in the operation table',
  '/api/public/probe/enrol': 'probe-runner wire protocol, specified in modules/observability/runner/probe-runner.protocol.ts and the runner README',
  '/api/public/probe/lease': 'probe-runner wire protocol, specified in modules/observability/runner/probe-runner.protocol.ts and the runner README',
  '/api/public/probe/results': 'probe-runner wire protocol, specified in modules/observability/runner/probe-runner.protocol.ts and the runner README',
  '/api/public/probe/heartbeat': 'probe-runner wire protocol, specified in modules/observability/runner/probe-runner.protocol.ts and the runner README',
  '/api/mcp/observability': 'MCP over streamable HTTP (JSON-RPC 2.0), specified by the Model Context Protocol; tools are listed by tools/list',
  '/api/observability/ai/settings': 'AI features admin API (phase 20), documented in the module README; not yet in the operation table',
  '/api/observability/ai/noise': 'AI features admin API (phase 20), documented in the module README; not yet in the operation table',
  '/api/observability/ai/query': 'AI features admin API (phase 20), documented in the module README; not yet in the operation table',
  '/api/observability/ai/usage': 'AI features admin API (phase 20), documented in the module README; not yet in the operation table',
  '/api/incidents/[incidentId]/ai': 'AI investigator API (phase 20), documented in the module README; not yet in the operation table',
  '/api/incidents/[incidentId]/ai/status-draft': 'AI investigator API (phase 20), documented in the module README; not yet in the operation table',
  '/api/incidents/[incidentId]/ai/postmortem-draft': 'AI investigator API (phase 20), documented in the module README; not yet in the operation table',
  '/api/incidents/[incidentId]/ai/[noteId]/feedback': 'AI investigator API (phase 20), documented in the module README; not yet in the operation table',
  '/api/telemetry/genai': 'LLM observability summary (phase 20), documented in server/telemetry/README.md',
  '/api/public/status/pages/[slug]': 'public status page API (phase 15): the page audience gate is the credential; documented in the module README and docs/phases/09-observability/15-status-page-v2.md',
  '/api/public/status/pages/[slug]/unlock': 'public status page API (phase 15): the page audience gate is the credential; documented in the module README and docs/phases/09-observability/15-status-page-v2.md',
  '/api/public/status/pages/[slug]/incidents': 'public status page API (phase 15): the page audience gate is the credential; documented in the module README and docs/phases/09-observability/15-status-page-v2.md',
  '/api/public/status/pages/[slug]/feed': 'public status page API (phase 15): the page audience gate is the credential; documented in the module README and docs/phases/09-observability/15-status-page-v2.md',
  '/api/public/status/pages/[slug]/calendar': 'public status page API (phase 15): the page audience gate is the credential; documented in the module README and docs/phases/09-observability/15-status-page-v2.md',
  '/api/public/status/pages/[slug]/badge': 'public status page API (phase 15): the page audience gate is the credential; documented in the module README and docs/phases/09-observability/15-status-page-v2.md',
  '/api/public/status/pages/[slug]/widget': 'public status page API (phase 15): the page audience gate is the credential; documented in the module README and docs/phases/09-observability/15-status-page-v2.md',
  '/api/status-pages': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/status-pages/[pageId]': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/status-groups': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/status-groups/[groupId]': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/status-translations': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/status-subscribers/[subscriberId]': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/status-automations': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/status-automations/[automationId]': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/cron/status-snapshot': 'cron twin (CRON_SECRET)',
  '/api/cron/ai-auto': 'cron twin (CRON_SECRET)',
  '/api/telemetry/genai/conversations/[conversationId]': 'conversation timeline of a tenant app (phase 20.6), documented in the module README; not yet in the operation table',
  '/api/incidents/[incidentId]/ai/timeline': 'conversation timeline of the AI assistant on an incident (phase 20.6), documented in the module README; not yet in the operation table',
  '/api/status-pages/[pageId]/snapshot': 'status page v2 admin API (phase 15), documented in the module README; not yet in the operation table',
  '/api/telemetry/lifecycle': 'telemetry retention and erasure, documented in server/telemetry/README.md',
}

const clean = (s: Record<string, unknown>): Record<string, unknown> => { const { $schema: _s, ...rest } = s; void _s; return rest }
const schemaOf = (dto: z.ZodType) => clean(z.toJSONSchema(dto, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>)

const toOpenApiPath = (p: string) => p.replace(/\[(\w+)\]/g, '{$1}')
const paramsOf = (p: string) => [...p.matchAll(/\[(\w+)\]/g)].map((x) => x[1])

export function observabilityOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {}
  for (const op of OPERATIONS) {
    const security =
      op.access === 'session' ? [{ sessionCookie: [] }]
        : op.access === 'ops' ? [{ sessionCookie: [] }, { bearerApiKey: [op.scope!] }]
        : op.access === 'config' ? [{ sessionCookie: [] }, { bearerApiKey: [op.method === 'GET' ? CONFIG_SCOPE_READ : op.path.endsWith('/plan') ? CONFIG_SCOPE_READ : CONFIG_SCOPE_WRITE] }]
          : []
    const pathParams = [
      ...paramsOf(op.path).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...(op.query ?? []).map((q) => ({ name: q.name, in: 'query', required: q.required === true, description: q.description, schema: q.schema })),
    ]
    const operation: Record<string, unknown> = {
      tags: [op.tag], summary: op.summary, operationId: `${op.method.toLowerCase()}${op.path.replace(/\[(\w+)\]/g, '_$1').replace(/[^A-Za-z0-9_]+/g, '_')}`,
      ...(pathParams.length ? { parameters: pathParams } : {}),
      ...(op.body ? { requestBody: { required: true, content: { 'application/json': { schema: { $ref: `#/components/schemas/${op.body}` } } } } } : {}),
      responses: { '200': op.produces ? { description: 'OK', content: Object.fromEntries(op.produces.map((t) => [t, {}])) } : { description: 'OK' }, '400': { $ref: '#/components/responses/Problem' }, '401': { $ref: '#/components/responses/Problem' }, '403': { $ref: '#/components/responses/Problem' }, '404': { $ref: '#/components/responses/Problem' }, '422': { $ref: '#/components/responses/Problem' } },
      security,
      ...(op.permissions ? { 'x-permissions': op.permissions } : {}),
      ...(op.access === 'ops' ? { 'x-api-key-scope': op.scope } : {}),
      ...(op.access === 'config' ? { 'x-api-key-scope': op.method === 'GET' || op.path.endsWith('/plan') ? CONFIG_SCOPE_READ : CONFIG_SCOPE_WRITE } : {}),
    }
    ;(paths[toOpenApiPath(op.path)] ??= {})[op.method.toLowerCase()] = operation
  }
  const schemas: Record<string, unknown> = Object.fromEntries(Object.entries(BODIES).map(([name, dto]) => [name, schemaOf(dto as z.ZodType)]))
  schemas.ObservabilityConfig = schemaOf(ObservabilityConfigDTO)
  schemas.Problem = { type: 'object', properties: { message: { type: 'string' }, code: { type: 'string' }, details: { type: 'object' } }, required: ['message'] }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Roltek Observability API',
      version: OPENAPI_VERSION_MAJOR,
      description: `Monitors, status pages, alerts, SLOs, incidents and monitoring-as-code. The configuration document is ${CONFIG_SCHEMA_ID}. Versioning: by contract; see the module README.`,
    },
    'x-api-version': OPENAPI_VERSION_MAJOR,
    'x-document-id': OPENAPI_DOC_ID,
    servers: [{ url: '/tenant/{tenantId}', variables: { tenantId: { default: 'tenant-id', description: 'The workspace id' } } }],
    tags: [...new Set(OPERATIONS.map((o) => o.tag))].map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: {
        sessionCookie: { type: 'apiKey', in: 'cookie', name: 'session', description: 'A console session. Every call needs the permission listed in x-permissions.' },
        bearerApiKey: { type: 'http', scheme: 'bearer', description: `An api_key of the workspace. Only two groups of endpoints accept one: the configuration endpoints, with the scope ${CONFIG_SCOPE_READ} (read, plan, export) or ${CONFIG_SCOPE_WRITE} (apply, detach); and four operational actions (acknowledge an alert, declare an incident, start a silence template, add an incident note), each with its own exact scope observability_ops:ack, :incident, :silence or :note, which no other scope (admin included) grants.` },
      },
      responses: { Problem: { description: 'An error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } } } },
      schemas,
    },
  }
}
