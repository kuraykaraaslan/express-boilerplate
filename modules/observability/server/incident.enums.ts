import { z } from 'zod'

/** The fixed vocabulary of the incident timeline (observability phase 14). A new kind of event is a deliberate addition here, never free text. */
export const INCIDENT_EVENT_TYPES = [
  'DECLARED', 'ALERT_LINKED', 'ACKNOWLEDGED', 'MITIGATED', 'RESOLVED', 'SEVERITY_CHANGED', 'PUBLISHED', 'UNPUBLISHED',
  'PUBLIC_UPDATE', 'ROLE_ASSIGNED', 'ROLE_REMOVED', 'TASK_ADDED', 'NOTE_ADDED', 'POSTMORTEM', 'AI_NOTE',
] as const
export const IncidentEventTypeEnum = z.enum(INCIDENT_EVENT_TYPES)
export type IncidentEventType = z.infer<typeof IncidentEventTypeEnum>

export const IncidentRoleEnum = z.enum(['COMMANDER', 'COMMS', 'RESPONDER', 'OBSERVER'])
export type IncidentRole = z.infer<typeof IncidentRoleEnum>

export const PostmortemStatusEnum = z.enum(['DRAFT', 'IN_REVIEW', 'PUBLISHED'])
export type PostmortemStatus = z.infer<typeof PostmortemStatusEnum>
