import { IncidentActionEnum, type AlertSeverity, type IncidentAction } from './alert.enums'

/**
 * What an alert group does about the incident, per severity (observability phase 11), unless the route that claimed it says otherwise.
 *
 * The default reproduces what the platform did before the alert layer existed: a debounced monitor outage opens an incident, so a
 * tenant that never touches this sees no change. INFO and WARNING only record: they exist to be seen and routed, not to open an incident.
 */
export const DEFAULT_INCIDENT_POLICY: Record<AlertSeverity, IncidentAction> = {
  CRITICAL: 'auto', MAJOR: 'auto', MINOR: 'auto', WARNING: 'never', INFO: 'never',
}

/** Setting key per severity (one `select` each, so the generic settings page can render them). */
export const INCIDENT_POLICY_SETTING_KEYS: Record<AlertSeverity, string> = {
  CRITICAL: 'observabilityIncidentOnCritical',
  MAJOR: 'observabilityIncidentOnMajor',
  MINOR: 'observabilityIncidentOnMinor',
  WARNING: 'observabilityIncidentOnWarning',
  INFO: 'observabilityIncidentOnInfo',
}

export function readIncidentPolicy(values: Readonly<Record<string, string | undefined>>): Record<AlertSeverity, IncidentAction> {
  const out = { ...DEFAULT_INCIDENT_POLICY }
  for (const sev of Object.keys(out) as AlertSeverity[]) {
    const parsed = IncidentActionEnum.safeParse(values[INCIDENT_POLICY_SETTING_KEYS[sev]])
    if (parsed.success) out[sev] = parsed.data
  }
  return out
}

/** A route's own `incident` setting wins over the tenant policy. */
export function incidentActionFor(policy: Record<AlertSeverity, IncidentAction>, severity: AlertSeverity, routeOverride: IncidentAction | null): IncidentAction {
  return routeOverride ?? policy[severity]
}
