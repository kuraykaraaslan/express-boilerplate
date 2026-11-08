import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'
import { limitOf } from './observability.limits'
import { alertMetrics } from './alert.metrics'
import { refusalDetails, refusalForReason } from './observability.refusals'

/**
 * The open-alerts cap (phase 16.4). A sender can mint a new alert with every label value, so "how many alerts exist" is something a
 * tenant, or whoever holds one of its keys, can inflate without limit. The plan can cap it; a refused alert is counted, never stored.
 * No cap is declared by default, so nothing changes until a plan opts in.
 */
const REASON = 'open_alert_cap'

export async function assertOpenAlertHeadroom(tenantId: string, count: () => Promise<number>): Promise<void> {
  const max = await limitOf(tenantId, K.OPEN_ALERTS)
  if (!Number.isFinite(max)) return
  const current = await count()
  if (current >= max) {
    alertMetrics.ingestRejected.inc({ reason: REASON })
    throw new AppError(`Your plan allows ${max} open alerts.`, 429, ErrorCode.RATE_LIMIT_EXCEEDED, { details: { reason: REASON, key: K.OPEN_ALERTS, limit: max, current, ...refusalDetails(refusalForReason('open_alert_cap')) } })
  }
}

export function isOpenAlertCapError(err: unknown): boolean {
  return err instanceof AppError && err.statusCode === 429 && (err as { details?: { reason?: string } }).details?.reason === REASON
}
