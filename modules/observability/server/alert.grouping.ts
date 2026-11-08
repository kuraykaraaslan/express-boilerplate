import type { Labels } from './alert.matchers'

/**
 * Grouping (observability phase 11): which alerts travel together, and when they are announced.
 *
 * `groupWait` is how long the FIRST alert of a new group waits so its siblings can join it; `groupInterval` is the minimum gap between
 * two announcements of the same group. Both are applied by writing a `dispatchAfter` time on the alert, so the sweep that sends them is
 * a plain query that survives a restart: there is no in-memory timer to lose.
 */

export const DEFAULT_GROUP_WAIT_SECONDS = 0
export const DEFAULT_GROUP_INTERVAL_SECONDS = 300
export const MAX_GROUP_SECONDS = 86_400

/** A stable key for a group: the values of the `groupBy` labels, in order. No `groupBy` means one group per alert. */
export function groupKeyFor(labels: Labels, groupBy: readonly string[], fingerprint: string): string {
  if (groupBy.length === 0) return `fp:${fingerprint}`
  return groupBy.map((k) => `${k}=${(labels[k] ?? '').slice(0, 120)}`).join('|').slice(0, 200)
}

export interface DispatchTiming {
  groupWaitSeconds: number
  groupIntervalSeconds: number
}

/**
 * When may an alert that just joined a group be announced?
 *  - the group has never been announced (`lastGroupNotifiedAt` null): after `groupWait` from now;
 *  - it has: no earlier than `groupInterval` after that announcement, and never in the past.
 */
export function dispatchTimeFor(now: Date, lastGroupNotifiedAt: Date | null, t: DispatchTiming): Date {
  const waitMs = Math.min(Math.max(0, t.groupWaitSeconds), MAX_GROUP_SECONDS) * 1000
  if (!lastGroupNotifiedAt) return new Date(now.getTime() + waitMs)
  const intervalMs = Math.min(Math.max(0, t.groupIntervalSeconds), MAX_GROUP_SECONDS) * 1000
  return new Date(Math.max(now.getTime(), lastGroupNotifiedAt.getTime() + intervalMs))
}
