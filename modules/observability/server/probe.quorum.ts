import { applyOutcome } from './uptime.probe.service'
import type { MonitorStatus, SampleStatus } from './uptime.enums'

/**
 * Multi-location verdicts (observability phase 10.4). Pure: no database, no clock of its own.
 *
 * A monitor with several locations keeps one DEBOUNCED state per location (the same state machine a single-location monitor uses, so
 * flapping in one region never pages), then combines them: DOWN when at least `k` of the fresh locations are DOWN, DEGRADED when only a
 * minority is (and which ones disagree is recorded), UP otherwise. A location that has not reported for several intervals is STALE and
 * is left out of the count rather than counted as either up or down: a dead runner must not read as an outage of the target, and must not
 * hide one either.
 */

/** The implicit location: the in-process probe. It exists for every monitor, so nothing regresses when locations are introduced. */
export const LOCAL_LOCATION = 'local'
export const LOCATION_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/

export interface LocationState {
  status: MonitorStatus
  consecutiveFailures: number
  consecutiveSuccesses: number
  /** ISO time of this location's last sample. */
  at: string
  latencyMs?: number | null
  error?: string | null
}
export type LocationStates = Record<string, LocationState>

export interface QuorumVerdict {
  status: MonitorStatus
  /** Locations that count (fresh and with a settled state). */
  counted: string[]
  /** Counted locations whose debounced state is DOWN. */
  down: string[]
  /** Counted locations that are available but slow. */
  degraded: string[]
  /** Configured locations that have not reported recently enough to count. */
  stale: string[]
  /** How many DOWN locations make the monitor DOWN. */
  required: number
}

/** A location is stale after this many intervals without a sample (never below three minutes: a one-second monitor must not flap on a slow runner). */
export const STALE_AFTER_INTERVALS = 3
export const MIN_STALE_MS = 180_000

export function staleAfterMs(intervalSeconds: number): number {
  return Math.max(MIN_STALE_MS, intervalSeconds * 1000 * STALE_AFTER_INTERVALS)
}

/** Advance ONE location's debounced state with a sample. UNKNOWN samples move nothing (the caller filters them, this keeps the function safe on its own). */
export function advanceLocation(
  prev: LocationState | undefined, sample: { status: SampleStatus; latencyMs?: number | null; error?: string | null }, threshold: number, now: Date,
): { state: LocationState; transition: 'DOWN' | 'RECOVERED' | null } {
  const base = prev ?? { status: 'UNKNOWN' as MonitorStatus, consecutiveFailures: 0, consecutiveSuccesses: 0, at: now.toISOString() }
  const next = applyOutcome({ lastStatus: base.status, consecutiveFailures: base.consecutiveFailures, consecutiveSuccesses: base.consecutiveSuccesses }, sample, threshold)
  return {
    state: {
      status: next.status, consecutiveFailures: next.consecutiveFailures, consecutiveSuccesses: next.consecutiveSuccesses, at: now.toISOString(),
      latencyMs: sample.latencyMs ?? null, error: sample.error ?? null,
    },
    transition: next.transition,
  }
}

/** The default quorum: a majority of the locations that count. */
export function defaultQuorum(counted: number): number { return Math.floor(counted / 2) + 1 }

export function combineLocations(
  states: LocationStates, configured: readonly string[], opts: { quorum?: number | null; now: Date; intervalSeconds: number },
): QuorumVerdict {
  const horizon = opts.now.getTime() - staleAfterMs(opts.intervalSeconds)
  const counted: string[] = []
  const stale: string[] = []
  for (const key of configured) {
    const s = states[key]
    if (!s) continue
    if (Date.parse(s.at) < horizon) { stale.push(key); continue }
    // A location still settling (UNKNOWN: its first samples are under the debounce threshold) has no opinion yet.
    if (s.status === 'UNKNOWN') continue
    counted.push(key)
  }
  const down = counted.filter((k) => states[k].status === 'DOWN')
  const degraded = counted.filter((k) => states[k].status === 'DEGRADED')
  if (counted.length === 0) return { status: 'UNKNOWN', counted, down, degraded, stale, required: 0 }
  const required = Math.min(counted.length, Math.max(1, opts.quorum && opts.quorum > 0 ? Math.floor(opts.quorum) : defaultQuorum(counted.length)))
  let status: MonitorStatus
  if (down.length >= required) status = 'DOWN'
  else if (down.length > 0 || degraded.length >= required) status = 'DEGRADED'
  else status = 'UP'
  return { status, counted, down, degraded, stale, required }
}

/**
 * The monitor-level transition from the previous debounced status to the combined verdict. There is no second debounce here: each location
 * already debounced its own samples, and a second one would make a real outage wait twice.
 */
export function quorumTransition(previous: MonitorStatus, combined: MonitorStatus): 'DOWN' | 'RECOVERED' | null {
  if (combined === 'DOWN' && previous !== 'DOWN') return 'DOWN'
  if (previous === 'DOWN' && (combined === 'UP' || combined === 'DEGRADED')) return 'RECOVERED'
  return null
}
