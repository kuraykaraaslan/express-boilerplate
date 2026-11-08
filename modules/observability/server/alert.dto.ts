import { z } from 'zod'
import { listFilter, listQuerySchema } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'
import { AlertSeverityEnum, AlertSourceEnum, AlertStatusEnum, IncidentActionEnum, IntegrationKindEnum } from './alert.enums'
import { LABEL_NAME, MAX_LABEL_VALUE, MatcherListSchema } from './alert.matchers'
import { RouteTargetListSchema } from './alert.decision'
import { MAX_GROUP_SECONDS } from './alert.grouping'

/** The longest a silence may last. A mute with no end is a deleted alert with extra steps. */
export const MAX_SILENCE_MINUTES = 30 * 24 * 60

const EntityKey = z.string().regex(/^(component|process|monitor|ext):[A-Za-z0-9_.:-]{1,120}$/, 'entity must look like component:<id>, process:<kind>, monitor:<id> or ext:<module>:<key>')
const Labels = z.record(z.string().regex(LABEL_NAME), z.string().max(MAX_LABEL_VALUE)).refine((m) => Object.keys(m).length <= 20, 'at most 20 labels')

export const ManualAlertDTO = z.object({
  title: z.string().min(1).max(300),
  severity: AlertSeverityEnum.default('WARNING'),
  labels: Labels.optional(),
  annotations: z.record(z.string().max(64), z.string().max(2000)).refine((m) => Object.keys(m).length <= 20).optional(),
})
export type ManualAlertInput = z.infer<typeof ManualAlertDTO>

export const CreateIntegrationDTO = z.object({
  name: z.string().min(1).max(120),
  kind: IntegrationKindEnum.default('GENERIC'),
  severityCeiling: AlertSeverityEnum.default('MAJOR'),
  defaultLabels: Labels.nullish(),
})
export type CreateIntegrationInput = z.infer<typeof CreateIntegrationDTO>
// The kind is fixed at creation: it decides which parser reads the key's payloads.
export const UpdateIntegrationDTO = patchSchema(CreateIntegrationDTO.omit({ kind: true }).extend({ enabled: z.boolean().default(true) }))
export type UpdateIntegrationInput = z.infer<typeof UpdateIntegrationDTO>

const GroupBy = z.array(z.string().regex(LABEL_NAME)).max(10)

export const CreateRouteDTO = z.object({
  name: z.string().min(1).max(120),
  position: z.number().int().min(0).max(10_000).optional(),
  matchers: MatcherListSchema.default([]),
  groupBy: GroupBy.default([]),
  groupWaitSeconds: z.number().int().min(0).max(MAX_GROUP_SECONDS).default(0),
  groupIntervalSeconds: z.number().int().min(0).max(MAX_GROUP_SECONDS).default(300),
  targets: RouteTargetListSchema.default([]),
  incident: IncidentActionEnum.nullish(),
  continueMatching: z.boolean().default(false),
  enabled: z.boolean().default(true),
})
export type CreateRouteInput = z.infer<typeof CreateRouteDTO>
export const UpdateRouteDTO = patchSchema(CreateRouteDTO)
export type UpdateRouteInput = z.infer<typeof UpdateRouteDTO>

export const SimulateRouteDTO = z.object({
  labels: Labels,
  severity: AlertSeverityEnum.optional(),
  source: z.enum(['monitor', 'process', 'slo', 'integration', 'manual', 'extension']).optional(),
})
export type SimulateRouteInput = z.infer<typeof SimulateRouteDTO>

export const CreateSilenceDTO = z.object({
  matchers: MatcherListSchema.refine((l) => l.length >= 1, 'a silence needs at least one matcher (it would mute everything otherwise)'),
  startsAt: z.coerce.date().optional(),
  endsAt: z.coerce.date().optional(),
  durationMinutes: z.number().int().min(1).max(MAX_SILENCE_MINUTES).optional(),
  reason: z.string().trim().min(3).max(500),
}).superRefine((s, ctx) => {
  if (!s.endsAt && !s.durationMinutes) ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'give endsAt or durationMinutes' })
})
export type CreateSilenceInput = z.infer<typeof CreateSilenceDTO>

export const CreateDependencyDTO = z.object({ child: EntityKey, parent: EntityKey })
export type CreateDependencyInput = z.infer<typeof CreateDependencyDTO>

/** The alert list (phase 43 list contract): public sort fields → `Alert` properties. Labels never sort or search. */
export const ALERT_SORTABLE = { lastFiredAt: 'lastFiredAt', startsAt: 'startsAt', title: 'title', status: 'status', count: 'count' } as const

export const ListAlertsQuery = listQuerySchema({
  sortable: ALERT_SORTABLE,
  defaultSort: 'lastFiredAt:desc',
  pageSize: { default: 25, max: 200 },
  filters: {
    status: listFilter.oneOf(AlertStatusEnum.options),
    severity: listFilter.oneOf(AlertSeverityEnum.options),
    source: listFilter.oneOf(AlertSourceEnum.options),
    lastFiredFrom: listFilter.day(),
    lastFiredTo: listFilter.day(),
    /** The older paging: `offset` rows in (with `limit`), turned into a page. */
    offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
  },
})
export type ListAlertsQuery = z.infer<typeof ListAlertsQuery>
