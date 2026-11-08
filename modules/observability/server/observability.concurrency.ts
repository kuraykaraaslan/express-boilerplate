/**
 * A per-tenant ceiling on requests being worked at once, for the public push endpoints (phase 16.5, "noisy-neighbour control"; measured in
 * docs/phases/09-observability/SCORECARD.md).
 *
 * A request rate limit says how many requests a tenant may send per minute; it does not say how many the process works on at the same moment. One process
 * serves every tenant, so thirty concurrent large batches from one tenant queue in front of everybody's request (measured on a shared server: the
 * other tenant's p95 went from 0.5 s to 10 s while the flooder stayed inside its rate limit). A tenant gets `max` slots; a request beyond them is refused AT
 * ONCE with a 429 and `Retry-After`, before its body is read, so it costs the process almost nothing and the slots that remain are other tenants'.
 *
 * Per process, on purpose: no Redis round trip on the hot path, no failure mode (a counter that cannot be reached cannot refuse anybody), and a bound that
 * holds exactly where the contention is: in this process's event loop. A deployment with N processes allows N times `max`, which is still bounded.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { refusalDetails, refusalForReason } from './observability.refusals'

export const DEFAULT_MAX_IN_FLIGHT = 4

const inFlight = new Map<string, number>()
const refused = new Map<string, number>()

/** Take a slot or throw a 429. Returns the release function (idempotent). */
export function acquireTenantSlot(tenantId: string, lane: string, max: number = DEFAULT_MAX_IN_FLIGHT): () => void {
  const key = `${lane}:${tenantId}`
  const current = inFlight.get(key) ?? 0
  if (current >= Math.max(1, max)) {
    refused.set(key, (refused.get(key) ?? 0) + 1)
    throw new AppError('This workspace has too many requests in progress; retry in a moment.', 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
      retryable: true, headers: { 'Retry-After': '1' },
      details: { reason: 'tenant_concurrency', lane, limit: max, ...refusalDetails(refusalForReason('tenant_concurrency')) },
    })
  }
  inFlight.set(key, current + 1)
  let released = false
  return () => {
    if (released) return
    released = true
    const n = (inFlight.get(key) ?? 1) - 1
    if (n <= 0) inFlight.delete(key); else inFlight.set(key, n)
  }
}

/** For the operator and the tests: what is in flight and what has been refused since the process started. */
export function concurrencyStats(): { inFlight: Record<string, number>; refused: Record<string, number> } {
  return { inFlight: Object.fromEntries(inFlight), refused: Object.fromEntries(refused) }
}

export function _resetConcurrency(): void { inFlight.clear(); refused.clear() }
