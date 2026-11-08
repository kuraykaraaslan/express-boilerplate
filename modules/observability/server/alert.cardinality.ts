/**
 * Cardinality caps for tenant-supplied alert labels (observability phase 16.5).
 *
 * An alert's identity is its labels (`alertFingerprint`), so a sender that puts an unbounded value into a label (a request id, a timestamp) mints a new
 * alert per message: rows, groups, notifications and dependency lookups all grow with it. Three bounds, all safety ceilings that hold without a plan:
 *
 *  1. Shape: at most `MAX_LABELS` labels, a key of at most 64 characters (the name grammar), a value of at most `MAX_LABEL_VALUE`, and at most
 *     `MAX_LABEL_BYTES` of key+value in total. Whatever does not fit is dropped (never thrown on: the sender is untrusted) and COUNTED by reason.
 *  2. Growth: the number of DISTINCT label sets (fingerprints) a tenant's senders may introduce per UTC day (`ALERT_LABEL_SETS_PER_DAY`, default
 *     `DEFAULT_LABEL_SETS_PER_DAY`). A new alert beyond it is refused with a 429 carrying a stable code; an alert that already exists is never refused.
 *  3. Our own sources (monitors, SLOs, processes, manual) are never capped: a monitor going down must always be able to raise its alert.
 *
 * The growth counter is a Redis set per tenant per day (bounded by the cap itself, expiring after two days) and fails OPEN.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { OBSERVABILITY_LIMIT_KEYS as K } from './observability.limit-keys'
import { limitOf } from './observability.limits'
import { LABEL_NAME, MAX_LABELS, MAX_LABEL_VALUE } from './alert.matchers'
import { alertMetrics } from './alert.metrics'
import { refusalDetails, refusalForReason } from './observability.refusals'
import { redisCall } from './observability.redis-guard'

export const MAX_LABEL_BYTES = 8_192
export const DEFAULT_LABEL_SETS_PER_DAY = 5_000
const REASON = 'label_set_growth'

export interface LabelReport {
  labels: Record<string, string>
  /** What was dropped or cut, by reason: `invalid_key`, `bad_type`, `over_count`, `over_bytes`, `value_truncated`. */
  dropped: Record<string, number>
}

/** `sanitizeLabels` with its books: the same output, plus how much was dropped and why. */
export function sanitizeLabelsReport(raw: unknown): LabelReport {
  const labels: Record<string, string> = {}
  const dropped: Record<string, number> = {}
  const note = (r: string) => { dropped[r] = (dropped[r] ?? 0) + 1 }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { labels, dropped }
  let bytes = 0
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(labels).length >= MAX_LABELS) { note('over_count'); continue }
    if (!LABEL_NAME.test(k) || k === '__proto__') { note('invalid_key'); continue }
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') { note('bad_type'); continue }
    let value = String(v)
    if (value.length > MAX_LABEL_VALUE) { value = value.slice(0, MAX_LABEL_VALUE); note('value_truncated') }
    if (bytes + k.length + value.length > MAX_LABEL_BYTES) { note('over_bytes'); continue }
    bytes += k.length + value.length
    labels[k] = value
  }
  return { labels, dropped }
}

/** Count what a sanitize dropped (one increment per reason, by the number dropped). */
export function countLabelDrops(dropped: Record<string, number>): number {
  let total = 0
  for (const [reason, n] of Object.entries(dropped)) {
    total += n
    for (let i = 0; i < Math.min(n, 50); i += 1) alertMetrics.labelsDropped.inc({ reason })
  }
  return total
}

export interface LabelSetStore {
  /** Remember `fingerprint` for `day`; returns the distinct count AFTER, or null when it was refused for being over `cap` (and not stored). */
  admit(tenantId: string, day: string, fingerprint: string, cap: number): Promise<{ admitted: boolean; count: number }>
}

export const redisLabelSetStore: LabelSetStore = {
  async admit(tenantId, day, fingerprint, cap) {
    try {
      const { default: redis } = await import('@kuraykaraaslan-labs/redis')
      const key = `obs:alert_label_sets:${tenantId}:${day}`
      return await redisCall(async () => {
        const added = await redis.sadd(key, fingerprint)
        if (added === 0) return { admitted: true, count: await redis.scard(key) }
        const count = await redis.scard(key)
        if (count === 1) await redis.expire(key, 2 * 86_400)
        if (count > cap) { await redis.srem(key, fingerprint); return { admitted: false, count: count - 1 } }
        return { admitted: true, count }
      })
    } catch { return { admitted: true, count: 0 } }
  },
}

export function memoryLabelSetStore(): LabelSetStore {
  const sets = new Map<string, Set<string>>()
  return {
    async admit(tenantId, day, fp, cap) {
      const k = `${tenantId}:${day}`
      let s = sets.get(k); if (!s) sets.set(k, (s = new Set()))
      if (s.has(fp)) return { admitted: true, count: s.size }
      if (s.size >= cap) return { admitted: false, count: s.size }
      s.add(fp); return { admitted: true, count: s.size }
    },
  }
}

let store: LabelSetStore = redisLabelSetStore
/** Test seam. */
export function setLabelSetStore(s?: LabelSetStore): void { store = s ?? redisLabelSetStore }

/** Refuse a NEW alert whose label set would take the tenant past its day's distinct-label-set cap. Only called for a sender's new alert. */
export async function assertLabelSetHeadroom(tenantId: string, fingerprint: string, now: Date = new Date()): Promise<void> {
  const planned = await limitOf(tenantId, K.ALERT_LABEL_SETS_PER_DAY)
  const cap = Number.isFinite(planned) ? Math.max(0, Math.floor(planned)) : DEFAULT_LABEL_SETS_PER_DAY
  const r = await store.admit(tenantId, now.toISOString().slice(0, 10), fingerprint, cap)
  if (r.admitted) return
  alertMetrics.ingestRejected.inc({ reason: REASON })
  throw new AppError(`This workspace's senders reached ${cap} distinct alert label sets today; reuse labels or wait until tomorrow.`, 429, ErrorCode.RATE_LIMIT_EXCEEDED, {
    details: { reason: REASON, key: K.ALERT_LABEL_SETS_PER_DAY, limit: cap, current: r.count, ...refusalDetails(refusalForReason('label_set_growth')) },
  })
}

export function isLabelSetGrowthError(err: unknown): boolean {
  return err instanceof AppError && err.statusCode === 429 && (err as { details?: { reason?: string } }).details?.reason === REASON
}
