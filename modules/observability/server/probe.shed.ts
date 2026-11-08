import Logger from '@kuraykaraaslan-labs/logger'

/**
 * What the control plane did NOT lease because a cap was hit (observability phase 10, respond track). Three outputs, all best effort: a shed must never
 * fail a poll, and a monitoring pipeline must not be taken down by the instrument that counts what it declined to do.
 *   - a counter, `probe_leases_shed_total{reason, tenantId}` (reason: `tenant` = the tenant's own cap, `global` = the platform cap);
 *   - per-location running totals in Redis (read by the runners screen and `GET /api/probe-locations/[id]/runners`), kept for a week;
 *   - a log line, at most one per (location, reason) per minute per process, so a sustained shed is one line a minute, not one per poll.
 */
export type ShedReason = 'tenant' | 'global'

export const SHED_LOG_EVERY_MS = 60_000
const SHED_STATS_TTL_SECONDS = 7 * 86_400

type CounterHandle = { inc(labels?: Record<string, string | number>, value?: number): void }
let shedHandle: CounterHandle | null = null
/** Loaded on first use: the lease path must not pay for (or fail on) the metrics stack when nothing is shed. */
async function shedCounter(): Promise<CounterHandle> {
  if (shedHandle) return shedHandle
  const { default: ObservabilityService } = await import('./observability.service')
  shedHandle = ObservabilityService.counter({ name: 'probe_leases_shed_total', help: 'Due probe checks not leased because a lease cap was hit (they stay due)', labelNames: ['reason', 'tenantId'] })
  return shedHandle
}

const lastLogged = new Map<string, number>()
/** Test seam: forget what was logged. */
export function resetShedLog(): void { lastLogged.clear() }

export interface ShedEvent { tenantId: string; locationId: string; locationKey: string; reason: ShedReason; count: number; cap: number | null; outstanding: number }

export interface ShedStats {
  /** Due checks declined since the counters were created (kept a week). */
  total: number
  tenant: number
  global: number
  lastAt: string | null
  lastReason: ShedReason | null
}

const key = (locationId: string) => `probe:shed:${locationId}`

export async function recordShed(ev: ShedEvent, now: Date = new Date()): Promise<void> {
  if (ev.count <= 0) return
  try { (await shedCounter()).inc({ reason: ev.reason, tenantId: ev.tenantId }, ev.count) } catch { /* telemetry must not break a poll */ }
  const logKey = `${ev.locationId}:${ev.reason}`
  const last = lastLogged.get(logKey) ?? 0
  if (now.getTime() - last >= SHED_LOG_EVERY_MS) {
    lastLogged.set(logKey, now.getTime())
    Logger.warn(`[probe.lease] shed ${ev.count} due check(s) at location ${ev.locationKey} (${ev.reason} cap ${ev.cap ?? 'n/a'}, ${ev.outstanding} outstanding, tenant ${ev.tenantId}); they stay due and are leased once capacity frees up`)
  }
  try {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis')
    const k = key(ev.locationId)
    await redis.multi()
      .hincrby(k, 'total', ev.count).hincrby(k, ev.reason, ev.count)
      .hset(k, 'lastAt', now.toISOString(), 'lastReason', ev.reason)
      .expire(k, SHED_STATS_TTL_SECONDS)
      .exec()
  } catch { /* stats are best effort: the counter and the log line above already recorded it */ }
}

export async function shedStatsFor(locationId: string): Promise<ShedStats> {
  const empty: ShedStats = { total: 0, tenant: 0, global: 0, lastAt: null, lastReason: null }
  try {
    const { default: redis } = await import('@kuraykaraaslan-labs/redis')
    const h = await redis.hgetall(key(locationId))
    if (!h || !h.total) return empty
    return {
      total: Number(h.total) || 0, tenant: Number(h.tenant) || 0, global: Number(h.global) || 0,
      lastAt: h.lastAt ?? null, lastReason: h.lastReason === 'tenant' || h.lastReason === 'global' ? h.lastReason : null,
    }
  } catch { return empty }
}
