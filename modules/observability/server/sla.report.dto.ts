import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { DAY_MS, resolvePeriod, type ReportPeriod } from './sla.report'

/**
 * Query of the SLA report routes. `from` and `to` are UTC dates (YYYY-MM-DD, both inclusive); when both are missing the report covers the last
 * `defaultDays` days up to and including today. `objective` (status-page report only) judges every row against a target.
 */
export const SlaQueryDTO = z.object({
  from: z.string().max(10).optional(),
  to: z.string().max(10).optional(),
  format: z.enum(['json', 'csv', 'pdf']).default('json'),
  objective: z.coerce.number().gt(50).lt(100).optional(),
})
export type SlaQuery = z.infer<typeof SlaQueryDTO>

const utcDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

export function periodFromQuery(query: Pick<SlaQuery, 'from' | 'to'>, now: Date, defaultDays: number): ReportPeriod {
  const to = query.to ?? utcDate(now.getTime())
  const toMs = Date.parse(`${to}T00:00:00.000Z`)
  // a missing `from` next to an unparsable `to` falls through to the same refusal as an explicit bad date
  // (no default is derived from it: new Date(NaN).toISOString() would throw a RangeError, a 500)
  const from = query.from ?? (Number.isFinite(toMs) ? utcDate(toMs - (defaultDays - 1) * DAY_MS) : to)
  const resolved = resolvePeriod(from, to, now)
  if (!resolved.ok) throw new AppError(resolved.error, 400, ErrorCode.VALIDATION_ERROR)
  return resolved.period
}
