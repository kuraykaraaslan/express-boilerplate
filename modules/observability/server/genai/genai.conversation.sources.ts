/** The real data sources of the incident AI timeline (phase 20.6): the AI runs, the `ai` usage log and the MCP tool-call audit rows. Each optional module may be absent. */
import { MoreThanOrEqual, LessThanOrEqual, Like, And } from 'typeorm';
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import { listRuns } from '../ai/ai.store';
import { loadAiPeer } from '../peers/peers';
import type { IncidentTimelineSources } from './genai.conversation';

export const realIncidentTimelineSources: IncidentTimelineSources = {
  async runs(tenantId, incidentId) {
    return (await listRuns(tenantId, incidentId)) as never;
  },
  async usage(tenantId, from, to) {
    const ai = await loadAiPeer(tenantId);
    if (!ai) return [];
    return withTenantRepositoryFor(tenantId, ai.usageLogEntity, (repo) => repo.find({ where: { tenantId, createdAt: And(MoreThanOrEqual(from), LessThanOrEqual(to)) }, order: { createdAt: 'ASC' }, take: 2000 })) as never;
  },
  async tools(tenantId, incidentId) {
    const mod = await ifActive(tenantId, 'audit_log', () => import('@kuraykaraaslan-labs/audit_log/server/entities/audit_log.entity'));
    if (!mod) return [];
    return withTenantRepositoryFor(tenantId, mod.AuditLog, (repo) => repo.find({
      where: { tenantId, resourceType: 'incident', resourceId: incidentId, action: Like('observability.mcp.%') }, order: { createdAt: 'ASC' }, take: 200,
    })) as never;
  },
};
