import type { Monitor } from './entities/monitor.entity'

/**
 * The monitor as the admin API shows it.
 *
 * Three columns are credentials and never leave the server: `secrets` (encrypted step secrets — only their NAMES are listed),
 * `heartbeatTokenHash` (only whether one exists) and, for HTTP monitors, `headers` values are masked because they usually carry an
 * auth token. The plaintext heartbeat token is returned once by create / rotate and nowhere else.
 */
export type MonitorView = Omit<Monitor, 'secrets' | 'heartbeatTokenHash' | 'headers'> & {
  secretNames: string[]
  hasHeartbeatToken: boolean
  /** Header NAMES with masked values. */
  headers: Record<string, string> | null
}

export function serializeMonitor(m: Monitor): MonitorView {
  const { secrets, heartbeatTokenHash, headers, ...rest } = m
  return {
    ...rest,
    secretNames: Object.keys(secrets ?? {}),
    hasHeartbeatToken: Boolean(heartbeatTokenHash),
    headers: headers ? Object.fromEntries(Object.keys(headers).map((k) => [k, '***'])) : null,
  }
}
