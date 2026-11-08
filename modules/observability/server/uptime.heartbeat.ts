import { createHash, randomBytes } from 'node:crypto'
import type { Monitor } from './entities/monitor.entity'
import type { CheckOutcome } from './uptime.probe.service'

/**
 * Heartbeat (push) monitors — a dead-man's switch (observability phase 09.3).
 *
 * The monitored job calls US; silence is the failure. The URL carries a token that is a CREDENTIAL: only its SHA-256 is stored, it is
 * shown once at creation or rotation, and logs carry only its prefix. A lookup by hash needs no constant-time compare, because the
 * hash of a 192-bit random token reveals nothing about it.
 *
 * The verdict is a pure function of stored timestamps. Pings record their own UP samples (so recovery is immediate); the minutely
 * sweep only records a sample when the job went quiet, which means the debounce and incident machinery run unchanged on missed beats.
 */

export const HEARTBEAT_TOKEN_PREFIX = 'hb_'
export const DEFAULT_GRACE_SECONDS = 60

export type HeartbeatSignal = 'ping' | 'start' | 'fail'

export function generateHeartbeatToken(): string {
  return HEARTBEAT_TOKEN_PREFIX + randomBytes(24).toString('base64url')
}

export function hashHeartbeatToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex')
}

/** Safe to log: the prefix says which token it was, not what it is. */
export function tokenPrefix(token: string): string {
  return token.slice(0, HEARTBEAT_TOKEN_PREFIX.length + 4)
}

/** Does this string look like something we issued? Cheap rejection before touching the database. */
export function looksLikeHeartbeatToken(token: string): boolean {
  return /^hb_[A-Za-z0-9_-]{32}$/.test(token)
}

type HeartbeatState = Pick<Monitor, 'intervalSeconds' | 'heartbeatGraceSeconds' | 'lastHeartbeatAt' | 'heartbeatStartedAt' | 'heartbeatState'> & { createdAt: Date }

/**
 * Is the job on schedule? A brand-new monitor is measured from its creation time, so it gets one full period before it can fail.
 */
export function heartbeatVerdict(m: HeartbeatState, now: Date): CheckOutcome {
  const periodMs = (m.intervalSeconds + (m.heartbeatGraceSeconds ?? DEFAULT_GRACE_SECONDS)) * 1000
  const last = m.lastHeartbeatAt ? new Date(m.lastHeartbeatAt) : null
  const reference = last ?? new Date(m.createdAt)

  if (m.heartbeatState === 'fail') {
    return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'job reported a failure' }
  }
  const started = m.heartbeatStartedAt ? new Date(m.heartbeatStartedAt) : null
  if (started && (!last || started.getTime() > last.getTime()) && now.getTime() - started.getTime() > periodMs) {
    return { status: 'DOWN', latencyMs: null, statusCode: null, error: 'job started but never reported finishing' }
  }
  const silentMs = now.getTime() - reference.getTime()
  if (silentMs > periodMs) {
    const secs = Math.floor(silentMs / 1000)
    return { status: 'DOWN', latencyMs: null, statusCode: null, error: `no heartbeat for ${secs}s (expected every ${m.intervalSeconds}s plus ${m.heartbeatGraceSeconds ?? DEFAULT_GRACE_SECONDS}s grace)` }
  }
  return { status: 'UP', latencyMs: null, statusCode: null, error: null }
}

/** Duration of the last run when the job sent `/start` before its finishing ping. */
export function runDurationMs(m: Pick<Monitor, 'heartbeatStartedAt'>, now: Date): number | null {
  if (!m.heartbeatStartedAt) return null
  const d = now.getTime() - new Date(m.heartbeatStartedAt).getTime()
  return d >= 0 && d < 86_400_000 ? d : null
}
