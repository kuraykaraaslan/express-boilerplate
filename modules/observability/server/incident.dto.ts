import { z } from 'zod'
import { IncidentSeverityEnum as IncidentSeverityList, IncidentStatusEnum as IncidentStatusList } from './uptime.enums'
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { IncidentRoleEnum } from './incident.enums'
import { IncidentUpdateStatusEnum } from './uptime.enums'

export const AssignRoleDTO = z.object({ userId: z.string().uuid(), role: IncidentRoleEnum })
export const NoteDTO = z.object({ content: z.string().trim().min(1).max(5000) })
export const TaskDTO = z.object({
  title: z.string().trim().min(1).max(200),
  assigneeUserId: z.string().uuid().nullish(),
  dueAt: z.coerce.date().nullish(),
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).optional(),
})
export const ReviewDTO = z.object({ reviewerUserId: z.string().uuid() })

/** A tenant's own wording for one public progress step in one locale (also the incident template entry of the monitoring-as-code document). */
export const UpsertTemplateDTO = z.object({
  status: IncidentUpdateStatusEnum,
  locale: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/),
  body: z.string().trim().min(1).max(2000),
})
export type UpsertTemplateInput = z.infer<typeof UpsertTemplateDTO>

export const RenderTemplateDTO = z.object({
  status: IncidentUpdateStatusEnum,
  locale: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/).default('en'),
  title: z.string().max(300).optional(),
  components: z.array(z.string().max(200)).max(20).optional(),
  severity: z.string().max(20).optional(),
})
export type RenderTemplateInput = z.infer<typeof RenderTemplateDTO>

/** The incident list (phase 43 list contract): open first, newest first by default; 100 a page as before. */
export const INCIDENT_SORTABLE = {
  status: 'status', createdAt: 'createdAt', startedAt: 'startedAt', resolvedAt: 'resolvedAt', severity: 'severity', title: 'title',
} as const

export const ListIncidentsQuery = listQuerySchema({
  sortable: INCIDENT_SORTABLE,
  defaultSort: 'status:asc,createdAt:desc',
  pageSize: { default: 100, max: 200 },
  filters: {
    status: listFilter.oneOf(IncidentStatusList.options),
    severity: listFilter.oneOf(IncidentSeverityList.options),
    monitorId: listFilter.uuids(),
    startedFrom: listFilter.day(),
    startedTo: listFilter.day(),
    /** `true` / `false`: only published (or only private) incidents. The status pages' translation screen reads the public ones. */
    isPublic: listFilter.flag(),
  },
})
export type ListIncidentsQuery = z.infer<typeof ListIncidentsQuery>
