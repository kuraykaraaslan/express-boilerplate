/**
 * The real `McpData`: thin, read-mostly adapters over the services the admin routes already use. Every call is made with the tenant the
 * route verified from the key; a missing row and another tenant's row are the same `null`, so a tool cannot be used to probe ids.
 *
 * Only whitelisted fields leave here. A monitor's headers, secrets, steps and heartbeat token hash never do.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { loadOnCallPeer } from '../peers/peers';
import AlertService from '../alert.service';
import AlertSilenceService from '../alert.silence.service';
import MonitorService from '../uptime.monitor.service';
import IncidentService from '../incident.service';
import IncidentWorkflowService from '../incident.workflow.service';
import SloService from '../slo.service';
import { Incident } from '../entities/incident.entity';
import { changeWindow, changesBetween } from '../incident.changes.service';
import { listIncidentEvents } from '../incident.timeline.service';
import { queryLogs, queryMetrics, searchTraces } from '../telemetry/telemetry.query.service';
import { mapTelemetryError } from '../telemetry/telemetry.http';
import { queryDeps } from '../telemetry/telemetry.routes.shared';
import { MAX_LABELS, MAX_LABEL_VALUE, MatcherListSchema, type Matcher } from '../alert.matchers';
import { cleanText } from '../hygiene';
import type { AlertView, CheckView, IncidentView, McpData, MonitorView, SloView, TimelineView } from './mcp.types';

const iso = (d: Date | string | null | undefined): string | null => (d ? new Date(d).toISOString() : null);

function incidentView(i: Incident): IncidentView {
  return {
    incidentId: i.incidentId, title: i.title, status: i.status, severity: i.severity, isAuto: i.isAuto, monitorId: i.monitorId ?? null,
    startedAt: iso(i.startedAt)!, resolvedAt: iso(i.resolvedAt), acknowledgedAt: iso(i.acknowledgedAt), mitigatedAt: iso(i.mitigatedAt), reason: i.reason ?? null,
  };
}

function alertView(a: Awaited<ReturnType<typeof AlertService.getById>>): AlertView {
  return {
    alertId: a.alertId, title: a.title, severity: a.severity, status: a.status, source: a.source, startsAt: iso(a.startsAt)!, lastFiredAt: iso(a.lastFiredAt)!,
    count: a.count, incidentId: a.incidentId ?? null, acknowledgedAt: iso(a.acknowledgedAt), suppressedBy: a.suppressedBy ?? null,
    labels: a.labels ?? {}, annotations: a.annotations ?? {},
  };
}

/** The matchers a silence for this alert uses: its own labels, exact. An alert with no labels cannot be silenced this way (it would mute everything). */
export function matchersForAlert(labels: Record<string, string>): Matcher[] {
  return Object.entries(labels ?? {}).slice(0, MAX_LABELS).filter(([, v]) => typeof v === 'string' && v.length <= MAX_LABEL_VALUE).slice(0, 10)
    .map(([label, value]) => ({ label, op: '=' as const, value }));
}

export const defaultMcpData: McpData = {
  async listMonitors(tenantId, { limit }) {
    const rows = await MonitorService.list(tenantId);
    return rows.slice(0, limit).map((m): MonitorView => ({
      monitorId: m.monitorId, name: m.name, type: m.type, target: m.target, isActive: m.isActive, lastStatus: m.lastStatus, lastCheckedAt: iso(m.lastCheckedAt),
      intervalSeconds: m.intervalSeconds, groupName: m.groupName ?? null, tags: Array.isArray(m.tags) ? m.tags.slice(0, 20) : [],
    }));
  },

  async monitorChecks(tenantId, monitorId, limit) {
    try { await MonitorService.getById(tenantId, monitorId); } catch (e) { if (e instanceof AppError && e.statusCode === 404) return null; throw e; }
    const rows = await MonitorService.listChecks(tenantId, monitorId, { limit });
    return rows.map((c): CheckView => ({ status: c.status, latencyMs: c.latencyMs ?? null, statusCode: c.statusCode ?? null, error: c.error ?? null, checkedAt: iso(c.checkedAt)!, duringMaintenance: c.duringMaintenance }));
  },

  async listIncidents(tenantId, { status, limit }) {
    return (await IncidentService.list(tenantId, { status, limit })).map(incidentView);
  },

  async getIncident(tenantId, incidentId) {
    const row = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }));
    return row ? incidentView(row) : null;
  },

  async incidentTimeline(tenantId, incidentId, limit) {
    const inc = await defaultMcpData.getIncident(tenantId, incidentId);
    if (!inc) return [];
    const events = await listIncidentEvents(tenantId, incidentId, limit);
    return events.map((e): TimelineView => ({ type: e.type, at: iso(e.createdAt)!, data: e.data ?? null }));
  },

  async incidentChanges(tenantId, incidentId, lookbackMinutes) {
    const row = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }));
    if (!row) return null;
    const { from, to } = changeWindow(row, new Date(), lookbackMinutes);
    return { from: from.toISOString(), to: to.toISOString(), items: await changesBetween(tenantId, from, to) };
  },

  async listAlerts(tenantId, opts) {
    return (await AlertService.list(tenantId, opts)).map(alertView);
  },

  async getAlert(tenantId, alertId) {
    try { return alertView(await AlertService.getById(tenantId, alertId)); } catch (e) { if (e instanceof AppError && e.statusCode === 404) return null; throw e; }
  },

  async sloStatus(tenantId, sloId) {
    const reports = sloId
      ? [{ slo: await SloService.getById(tenantId, sloId).catch((e) => { if (e instanceof AppError && e.statusCode === 404) return null; throw e; }), report: null as Awaited<ReturnType<typeof SloService.report>> | null }]
      : await SloService.reports(tenantId);
    const out: SloView[] = [];
    for (const r of reports) {
      if (!r.slo) continue;
      const report = r.report ?? (sloId ? await SloService.report(tenantId, r.slo.sloId) : null);
      out.push({
        sloId: r.slo.sloId, name: r.slo.name, objectivePercent: Number(r.slo.objectivePercent), windowDays: r.slo.windowDays,
        budget: report?.budget ?? null, currentBurn: report?.currentBurn ?? null, projectedExhaustionDays: report?.projectedExhaustionDays ?? null,
        firing: !!report?.tiers.some((t) => t.firing),
      });
    }
    return out;
  },

  async onCall(tenantId) {
    const svc = await loadOnCallPeer(tenantId);
    if (!svc) return null;
    const schedules = await svc.listSchedules(tenantId);
    return schedules.filter((s) => s.schedule.isActive).map((s) => ({
      scheduleId: s.schedule.scheduleId, name: s.schedule.name, userId: s.onCall.userId ?? null, source: s.onCall.source ?? null, until: s.onCall.shiftEnd ? iso(s.onCall.shiftEnd as never) : null,
    }));
  },

  async queryLogs(tenantId, input) {
    try {
      const r = await queryLogs(queryDeps, tenantId, input);
      return { records: r.records, truncated: r.truncated };
    } catch (e) { throw mapTelemetryError(e); }
  },
  async queryTraces(tenantId, input) {
    try { return await searchTraces(queryDeps, tenantId, input); } catch (e) { throw mapTelemetryError(e); }
  },
  async queryMetrics(tenantId, input) {
    try { return await queryMetrics(queryDeps, tenantId, input); } catch (e) { throw mapTelemetryError(e); }
  },

  async ackAlert(tenantId, alertId) {
    const a = await AlertService.acknowledge(tenantId, alertId, null);
    return { alertId: a.alertId, acknowledgedAt: iso(a.acknowledgedAt) };
  },

  async silenceAlert(tenantId, req, keyId) {
    const alert = await AlertService.getById(tenantId, req.alertId);
    const matchers = MatcherListSchema.parse(matchersForAlert(alert.labels ?? {}));
    if (matchers.length === 0) throw new AppError('This alert has no labels to match, so it cannot be silenced without muting everything', 409, ErrorCode.CONFLICT);
    const reason = cleanText(`[mcp key ${keyId.slice(0, 8)}] ${req.reason}`, { max: 500 });
    const s = await AlertSilenceService.create(tenantId, { matchers, durationMinutes: req.durationMinutes, reason } as never, null);
    return { silenceId: s.silenceId, endsAt: iso(s.endsAt)!, matchers: matchers.length };
  },

  async addIncidentNote(tenantId, incidentId, content, keyId) {
    return IncidentWorkflowService.addNote(tenantId, incidentId, cleanText(`[via MCP key ${keyId.slice(0, 8)}] ${content}`, { max: 2000 }), null, `MCP key ${keyId.slice(0, 8)}`);
  },
};

