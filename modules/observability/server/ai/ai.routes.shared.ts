/** The production wiring of the AI route handlers: real services behind the ports of the AI features (phase 20). Resolved per call, imported lazily. */
import IncidentPostmortemService from '../incident.postmortem.service';
import IncidentTemplateService from '../incident.templates.service';
import { queryLogs, queryMetrics, searchTraces } from '../telemetry/telemetry.query.service';
import { mapTelemetryError } from '../telemetry/telemetry.http';
import { queryDeps } from '../telemetry/telemetry.routes.shared';
import { realInvestigatorDeps } from './ai.deps';
import type { DraftDeps, PostmortemDraftDeps } from './ai.drafts';
import type { NlQueryDeps } from './ai.nlquery';

export { realInvestigatorDeps };

export const realDraftDeps = (): DraftDeps => ({
  ...realInvestigatorDeps(),
  renderTemplate: (tenantId, i) => IncidentTemplateService.render(tenantId, { status: i.status as never, locale: i.locale, title: i.title, severity: i.severity }),
});

export const realPostmortemDeps = (): PostmortemDraftDeps => ({
  ...realInvestigatorDeps(),
  postmortem: {
    createDraft: (t, id, author) => IncidentPostmortemService.createDraft(t, id, author),
    update: (t, id, patch) => IncidentPostmortemService.update(t, id, patch),
  },
});

export const realNlDeps = (): NlQueryDeps => ({
  ...realInvestigatorDeps(),
  async run(tenantId, signal, query) {
    try {
      if (signal === 'logs') { const r = await queryLogs(queryDeps, tenantId, query); return { records: r.records, truncated: r.truncated, facets: r.facets }; }
      if (signal === 'traces') return await searchTraces(queryDeps, tenantId, query);
      return await queryMetrics(queryDeps, tenantId, query);
    } catch (e) { throw mapTelemetryError(e); }
  },
});
