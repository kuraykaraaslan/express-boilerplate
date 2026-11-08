import { z } from 'zod'
import { patchSchema } from '@kuraykaraaslan-labs/common/server/zod-patch'

export const SloKindEnum = z.enum(['MONITOR_AVAILABILITY', 'MONITOR_LATENCY', 'METRIC_RATIO'])
export type SloKind = z.infer<typeof SloKindEnum>

export const SLO_WINDOWS = [7, 28, 30, 90] as const

export const SloFieldsDTO = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().max(500).nullish(),
  kind: SloKindEnum.default('MONITOR_AVAILABILITY'),
  objectivePercent: z.number().gt(50).lt(100).multipleOf(0.001).default(99.9),
  windowDays: z.union([z.literal(7), z.literal(28), z.literal(30), z.literal(90)]).default(30),
  monitorIds: z.array(z.string().uuid()).max(100).default([]),
  componentId: z.string().uuid().nullish(),
  latencyThresholdMs: z.number().int().min(1).max(600_000).nullish(),
  metricSpec: z.object({ goodQuery: z.string().min(1).max(2000), totalQuery: z.string().min(1).max(2000) }).nullish(),
  lowBudgetPercent: z.number().int().min(1).max(90).default(25),
  burnAlerts: z.boolean().default(true),
  isActive: z.boolean().default(true),
})

/** What each kind needs. Returns a reason or null; shared by create, update and the OpenSLO importer. */
export function sloProblem(s: { kind: string; monitorIds?: string[]; componentId?: string | null; latencyThresholdMs?: number | null; metricSpec?: unknown }): string | null {
  if (s.kind === 'METRIC_RATIO') return s.metricSpec ? null : 'a METRIC_RATIO SLO needs metricSpec { goodQuery, totalQuery }'
  if (!s.componentId && (s.monitorIds?.length ?? 0) === 0) return 'choose the monitors (or a status component) whose samples are the events'
  if (s.kind === 'MONITOR_LATENCY' && !s.latencyThresholdMs) return 'a MONITOR_LATENCY SLO needs latencyThresholdMs'
  return null
}

export const CreateSloDTO = SloFieldsDTO.superRefine((s, ctx) => {
  const p = sloProblem(s)
  if (p) ctx.addIssue({ code: 'custom', path: ['kind'], message: p })
})
export type CreateSloInput = z.infer<typeof CreateSloDTO>

export const UpdateSloDTO = patchSchema(SloFieldsDTO)
export type UpdateSloInput = z.infer<typeof UpdateSloDTO>

export const ImportOpenSloDTO = z.object({
  format: z.enum(['yaml', 'json']),
  content: z.string().min(1).max(500_000),
  dryRun: z.boolean().default(true),
})
export type ImportOpenSloInput = z.infer<typeof ImportOpenSloDTO>

/** `GET /api/slos/{id}/burn?points=N`: how many points the burn series may have at most (bounded so the route cannot be asked for a huge series). */
export const BURN_POINTS_MIN = 2
export const BURN_POINTS_MAX = 200
export const BURN_POINTS_DEFAULT = 120
export const BurnQueryDTO = z.object({ points: z.coerce.number().int().min(BURN_POINTS_MIN).max(BURN_POINTS_MAX).default(BURN_POINTS_DEFAULT) })
export type BurnQuery = z.infer<typeof BurnQueryDTO>
