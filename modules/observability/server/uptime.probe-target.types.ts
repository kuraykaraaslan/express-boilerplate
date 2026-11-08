import type { MonitorType } from './uptime.enums'

/** One thing a module wants probed, e.g. a configured national-id or e-signature provider endpoint. */
export interface ProbeTargetSpec {
  /** Stable within the contributing module (`[a-z0-9._-]{1,100}`); with the module id it is the monitor's `sourceKey`. */
  key: string
  name: string
  type: MonitorType
  /** URL for HTTP, host:port for TCP, host for PING/DNS — same shape as `Monitor.target`. */
  target: string
  intervalSeconds?: number
  timeoutMs?: number
  expectedStatus?: number | null
  degradedLatencyMs?: number | null
}

/**
 * Default export of an `observability:probe-target` contribution. Return the targets that exist for THIS tenant right now (an unconfigured provider
 * returns `[]`). Throwing means "I could not tell" — the monitors this module already owns are then left untouched.
 */
export interface ProbeTargetProvider {
  listTargets(tenantId: string): Promise<ProbeTargetSpec[]>
}

export const PROBE_TARGET_POINT = 'observability:probe-target'
