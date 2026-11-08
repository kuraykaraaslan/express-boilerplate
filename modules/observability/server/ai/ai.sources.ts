/**
 * The real `EvidenceSources` (phase 20.2): the services the admin routes already use, called with the tenant the route verified. Each source
 * answers `null` when it cannot (module off, backend not configured), which the bundle reports as unavailable.
 */
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { loadSearchPeer } from '../peers/peers';
import { AppError } from '@kuraykaraaslan-labs/common/server/app-error';
import { Alert } from '../entities/alert.entity';
import { Incident } from '../entities/incident.entity';
import { changesBetween } from '../incident.changes.service';
import SloService from '../slo.service';
import { correlate } from '../telemetry/telemetry.query.service';
import { queryDeps } from '../telemetry/telemetry.routes.shared';
import type { EvidenceSources, SimilarFacts } from './ai.evidence';
import { INCIDENT_ENTITY_TYPE, incidentText, loadIncidentContext, similarityQuery } from '../incident.search';
import { embeddingSettings, similarByEmbedding } from '../incident.embedding';

const DAY = 86_400_000;

export const defaultEvidenceSources: EvidenceSources = {
  async incident(tenantId, incidentId) {
    return withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }));
  },

  async alerts(tenantId, incidentId) {
    const rows = await withTenantRepositoryFor(tenantId, Alert, (repo) => repo.find({ where: { tenantId, incidentId }, order: { lastFiredAt: 'DESC' }, take: 20 }));
    return rows.map((a) => ({ alertId: a.alertId, title: a.title, severity: a.severity, status: a.status, count: a.count, startsAt: a.startsAt, labels: a.labels ?? {}, annotations: a.annotations ?? {} }));
  },

  async changes(tenantId, from, to) {
    return changesBetween(tenantId, from, to);
  },

  async telemetry(tenantId, incident) {
    try {
      const c = await correlate(queryDeps, tenantId, { atMs: new Date(incident.startedAt).getTime() + 5 * 60_000, windowMs: 15 * 60_000 });
      return { logs: c.logs.filter((l) => ['WARN', 'ERROR', 'FATAL'].includes(l.severity)), traces: c.traces, metrics: c.metrics };
    } catch (e) {
      // Not configured (503), not supported (501), over a cap (400): all the same to the investigator, "no telemetry".
      if (e instanceof AppError) return null;
      throw e;
    }
  },

  async slos(tenantId) {
    const all = await SloService.reports(tenantId);
    return all.filter((r) => r.report && r.report.budget.state !== 'OK' && r.report.budget.state !== 'NO_DATA')
      .map((r) => ({ sloId: r.slo.sloId, name: r.slo.name, state: r.report!.budget.state, currentBurn: r.report!.currentBurn, remainingFraction: r.report!.budget.remainingFraction }));
  },

  async similar(tenantId, incident) {
    const since = new Date(new Date(incident.startedAt).getTime() - 90 * DAY);
    const rows = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.find({ where: { tenantId, status: 'RESOLVED' }, order: { startedAt: 'DESC' }, take: 300 }));
    const out: SimilarFacts[] = [];
    const factsOf = (r: Incident, via: SimilarFacts['via'], score?: number): SimilarFacts => ({
      incidentId: r.incidentId, title: r.title, severity: r.severity, startedAt: r.startedAt, reason: r.reason ?? null, via, ...(score !== undefined ? { score } : {}),
      durationMinutes: r.resolvedAt ? Math.round((new Date(r.resolvedAt).getTime() - new Date(r.startedAt).getTime()) / 60_000) : null,
    });
    for (const r of rows) {
      if (r.incidentId === incident.incidentId || new Date(r.startedAt) < since) continue;
      const via = incident.alertGroupKey && r.alertGroupKey === incident.alertGroupKey ? 'same_group' : incident.monitorId && r.monitorId === incident.monitorId ? 'same_monitor' : null;
      if (via) out.push(factsOf(r, via));
    }
    const taken = () => new Set(out.map((o) => o.incidentId));
    const resolved = new Map(rows.map((r) => [r.incidentId, r]));
    const lookupText = async () => incidentText(incident as unknown as Incident, await loadIncidentContext(tenantId, incident as unknown as Incident));

    // The `search` module, when installed, adds incidents whose text resembles this one (they are indexed on open, edit and resolve:
    // `incident.search.ts`). The query is the distinctive words joined with OR. Its failure never fails the bundle.
    try {
      const svc = await loadSearchPeer(tenantId);
      const query = svc ? similarityQuery(await lookupText()) : null;
      if (svc && query) {
        const hits = await svc.search(tenantId, query, { entityType: INCIDENT_ENTITY_TYPE, limit: 10 });
        for (const h of hits.hits) {
          if (h.entityId === incident.incidentId || taken().has(h.entityId)) continue;
          const meta = (h.metadata ?? {}) as { status?: string; severity?: string; startedAt?: string | null; durationMinutes?: number | null };
          if (meta.status && meta.status !== 'RESOLVED') continue;
          const row = resolved.get(h.entityId);
          out.push(row ? factsOf(row, 'search', h.rank) : { incidentId: h.entityId, title: h.title, severity: meta.severity ?? 'unknown', startedAt: meta.startedAt ?? null, durationMinutes: meta.durationMinutes ?? null, via: 'search', score: h.rank });
        }
      }
    } catch { /* optional */ }

    // Embedding similarity, only for a tenant that switched it on (`similarByEmbedding`); nothing is embedded or stored otherwise.
    try {
      if (await embeddingSettings(tenantId)) {
        for (const m of await similarByEmbedding(tenantId, incident, await lookupText())) {
          const row = resolved.get(m.incidentId);
          if (!row || taken().has(m.incidentId)) continue;
          out.push(factsOf(row, 'embedding', m.score));
        }
      }
    } catch { /* optional */ }
    return out.slice(0, 6);
  },
};
