import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'
import { limitOf } from './observability.limits'
import { refusalDetails, refusalForLimit, refusalForReason } from './observability.refusals'

/**
 * A per-TENANT request budget for the public push endpoints (phase 16.4). The per-address limiter stops one noisy caller; this stops one
 * noisy TENANT (a hundred senders behind a hundred addresses) from using the shared pipeline's capacity.
 *
 * It is asked AFTER the credential has matched, never before: unauthenticated requests must not be able to spend a tenant's budget.
 * Fails open: if the counter is unavailable, the request goes through.
 */
export type BudgetLane = 'alert_ingest' | 'heartbeat'

const LANES: Record<BudgetLane, { key: string; fallbackPerMinute: number }> = {
  alert_ingest: { key: K.ALERT_INGEST_PER_MINUTE, fallbackPerMinute: 600 },
  heartbeat: { key: K.HEARTBEATS_PER_MINUTE, fallbackPerMinute: 3000 },
}

type Counter = (bucket: string, limit: number, tenantId: string) => Promise<{ success: boolean; retryAfter: number }>

const defaultCounter: Counter = async (bucket, limit, tenantId) => {
  try {
    const { check } = await import('@kuraykaraaslan-labs/limiter')
    const r = await check(bucket, 'api', { failMode: 'open', tenantId, limit })
    return { success: r.success, retryAfter: r.retryAfter }
  } catch { return { success: true, retryAfter: 0 } }
}

let counter: Counter = defaultCounter

/** Test seam. */
export function setBudgetCounter(fn?: Counter): void { counter = fn ?? defaultCounter }

export async function checkTenantBudget(tenantId: string, lane: BudgetLane): Promise<void> {
  const cfg = LANES[lane]
  const planned = await limitOf(tenantId, cfg.key)
  // The plan may RAISE or lower the budget; the fallback is a safety ceiling, not a product limit.
  const limit = Number.isFinite(planned) ? Math.max(1, Math.floor(planned)) : cfg.fallbackPerMinute
  const r = await counter(`obs:${lane}:${tenantId}`, limit, tenantId)
  if (!r.success) {
    throw new AppError('This workspace is sending too fast; slow down and retry.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, { details: { lane, key: cfg.key, limit, limitPerMinute: limit, retryAfter: r.retryAfter, ...refusalDetails(refusalForReason('request_budget')) } })
  }
}
