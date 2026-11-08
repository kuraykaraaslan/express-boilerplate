/**
 * The contracts of the incident workflow's three optional neighbours (observability phase 14). `observability` is a Core module and `comments`, `tasks`
 * and `document` are Pro modules, so it does not import them (ADR-0001, phase 35/02): it owns these small ports, declares one extension point for
 * each (`observability:incident-notes`, `observability:incident-tasks`, `observability:document-publisher`), and the module that has the store
 * contributes the adapter (`comments/server/comments.incident-notes`, `tasks/server/tasks.incident-tasks`, `document/server/document.postmortem-publisher`).
 * Pure types plus the few constants both sides must agree on.
 */

/** The comments module only accepts an UPPER_SNAKE subject type (a lowercase one failed validation in production, which the mocked tests never saw). */
export const INCIDENT_NOTE_SUBJECT = 'INCIDENT'

/** `observability:incident-notes`: internal notes on an incident, kept as comments on a subject. Nothing here reaches the status page. */
export interface IncidentNoteSink {
  /** `authorName` names the writer when there is no user (an api key): the store refuses a note nobody wrote. */
  create(tenantId: string, input: { subjectType: string; subjectId: string; content: string; authorUserId?: string; authorName?: string }): Promise<{ commentId: string }>
  /** The notes of one subject, oldest page first, at most 100. */
  list(tenantId: string, query: { subjectType: string; subjectId: string }): Promise<unknown[]>
  /** Delete every note of each subject (the retention pass). A note that cannot be deleted is skipped, never fatal. */
  deleteForSubjects(tenantId: string, query: { subjectType: string; subjectIds: string[] }): Promise<void>
}

/** `observability:incident-tasks`: follow-up tasks related to an incident. */
export interface IncidentTaskSink {
  create(tenantId: string, input: {
    title: string; priority: string; assigneeUserId: string | null; dueAt: Date | null; relatedType: string; relatedId: string
  }, actorUserId?: string): Promise<{ taskId: string }>
  list(tenantId: string, query: { relatedType: string; relatedId: string }): Promise<unknown[]>
}

/** The post-mortem's document type code in the tenant's catalogue, and the owner type its documents hang from. */
export const POSTMORTEM_DOCUMENT_TYPE = 'INCIDENT_POSTMORTEM'
export const POSTMORTEM_OWNER_TYPE = 'INCIDENT'

/** `observability:document-publisher`: files the post-mortem write-up as a versioned document. */
export interface DocumentPort {
  /**
   * File a new VERSION of the write-up. `documentId` is the one a previous publication created (a republication adds the next version to it,
   * a published version is never edited). Null = no document store is in use for this tenant.
   */
  publishVersion(tenantId: string, input: {
    documentId: string | null; incidentId: string; postmortemId: string; title: string; markdown: string; isPrivate: boolean; actorId: string | null; changeNote: string
  }): Promise<{ documentId: string; versionNo: number } | null>
}
