import type { AlertSeverity } from './alert.enums'

/** One thing a module says is wrong right now. */
export interface AlertSourceSpec {
  /** Stable within the contributing module (`[a-z0-9._-]{1,100}`); with the module id it is the alert's identity. */
  key: string
  title: string
  severity?: AlertSeverity
  /** Free labels for routing and grouping. `entity` and `monitorId` are reserved and ignored: the pipeline assigns the entity itself. */
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

/**
 * Default export of an `observability:alert-source` contribution. Return what is firing for THIS tenant right now: the pipeline raises what
 * is listed, and resolves what it raised before and is no longer listed. An empty list means "all clear". Throwing means "I could not tell":
 * the alerts this module already raised are left exactly as they are, because failing to look is not evidence of recovery.
 */
export interface AlertSourceProvider {
  listFiring(tenantId: string): Promise<AlertSourceSpec[]>
}

export const ALERT_SOURCE_POINT = 'observability:alert-source'
