import { ext, tenantCtx } from '@kuraykaraaslan-labs/common/server/extensions/ext'
import { observabilityIncidentNotesLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.incident-notes'
import { observabilityIncidentTasksLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.incident-tasks'
import { observabilityDocumentPublisherLoaders } from '@kuraykaraaslan-labs/common/server/generated/extensions/observability.document-publisher'
import type { DocumentPort, IncidentNoteSink, IncidentTaskSink } from './incident.integration.types'

/**
 * Where the incident workflow finds the stores it does not own: notes (`comments`), follow-up tasks (`tasks`) and the published post-mortem text
 * (`document`). `observability` does not know any of them; a module that has one contributes to the point, so a workspace without it simply has no
 * notes, no tasks and no document: the same behaviour as before, now without an import of a module that may not be installed (or that belongs to a
 * higher edition). Declared in observability/module.json `extensionPoints`; the contracts are in `incident.integration.types.ts`.
 *
 * Each answers `null` when no module active for the tenant provides one (or the one that does cannot be loaded; the runtime logs that).
 */
export const INCIDENT_NOTES_POINT = 'observability:incident-notes'
export const INCIDENT_TASKS_POINT = 'observability:incident-tasks'
export const DOCUMENT_PUBLISHER_POINT = 'observability:document-publisher'

export async function loadIncidentNotes(tenantId: string): Promise<IncidentNoteSink | null> {
  const found = await ext.first<IncidentNoteSink, IncidentNoteSink>(INCIDENT_NOTES_POINT, tenantCtx(tenantId), observabilityIncidentNotesLoaders, (sink) => sink)
  return found?.value ?? null
}

export async function loadIncidentTasks(tenantId: string): Promise<IncidentTaskSink | null> {
  const found = await ext.first<IncidentTaskSink, IncidentTaskSink>(INCIDENT_TASKS_POINT, tenantCtx(tenantId), observabilityIncidentTasksLoaders, (sink) => sink)
  return found?.value ?? null
}

export async function loadDocumentPublisher(tenantId: string): Promise<DocumentPort | null> {
  const found = await ext.first<DocumentPort, DocumentPort>(DOCUMENT_PUBLISHER_POINT, tenantCtx(tenantId), observabilityDocumentPublisherLoaders, (sink) => sink)
  return found?.value ?? null
}
