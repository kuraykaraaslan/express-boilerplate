/** The resolve-time hook of the embedding similarity: embed the resolved incident's text so a later incident can find it. Off unless the tenant opted in. Never throws. */
import { withTenantRepositoryFor } from '@kuraykaraaslan-labs/db';
import { Incident } from './entities/incident.entity';
import { incidentText, loadIncidentContext } from './incident.search';
import { embeddingSettings, ensureIncidentEmbedding } from './incident.embedding';

export async function embedResolvedIncident(tenantId: string, incidentId: string): Promise<boolean> {
  try {
    if (!(await embeddingSettings(tenantId))) return false;
    const incident = await withTenantRepositoryFor(tenantId, Incident, (repo) => repo.findOne({ where: { tenantId, incidentId } }));
    if (!incident) return false;
    return (await ensureIncidentEmbedding(tenantId, incidentId, incidentText(incident, await loadIncidentContext(tenantId, incident)))) !== null;
  } catch {
    return false;
  }
}
