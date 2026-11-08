import { z } from 'zod'

/**
 * Alert vocabulary (observability phase 11).
 *
 * An alert is a SIGNAL that something needs attention; an incident (`uptime.enums`) is the HUMAN RESPONSE UNIT that may own many alerts
 * and may be shown on the status page. They are different records on purpose: today a probe flap *is* an incident, which can neither
 * group, silence nor route.
 */
export const AlertSeverityEnum = z.enum(['INFO', 'WARNING', 'MINOR', 'MAJOR', 'CRITICAL'])
export type AlertSeverity = z.infer<typeof AlertSeverityEnum>

/** Low to high, so a group's severity is the maximum of its members. */
export const ALERT_SEVERITY_ORDER: readonly AlertSeverity[] = ['INFO', 'WARNING', 'MINOR', 'MAJOR', 'CRITICAL']

export const AlertStatusEnum = z.enum(['FIRING', 'RESOLVED', 'SUPPRESSED'])
export type AlertStatus = z.infer<typeof AlertStatusEnum>

/** Where a signal came from. `extension` covers modules contributing through `observability:alert-source`. */
export const AlertSourceEnum = z.enum(['monitor', 'process', 'slo', 'integration', 'manual', 'extension'])
export type AlertSource = z.infer<typeof AlertSourceEnum>

export const IntegrationKindEnum = z.enum(['GENERIC', 'ALERTMANAGER', 'GRAFANA'])
export type IntegrationKind = z.infer<typeof IntegrationKindEnum>

export const MatcherOpEnum = z.enum(['=', '!=', '=~', '!~'])
export type MatcherOp = z.infer<typeof MatcherOpEnum>

export const RouteTargetTypeEnum = z.enum(['notify', 'webhook', 'on_call', 'drop'])
export type RouteTargetType = z.infer<typeof RouteTargetTypeEnum>

/** What the incident policy does when a group of alerts is dispatched. */
export const IncidentActionEnum = z.enum(['auto', 'never'])
export type IncidentAction = z.infer<typeof IncidentActionEnum>

export function severityRank(s: string): number {
  const i = ALERT_SEVERITY_ORDER.indexOf(s as AlertSeverity)
  return i < 0 ? 0 : i
}

export function maxSeverity(list: readonly string[]): AlertSeverity {
  let best: AlertSeverity = 'INFO'
  for (const s of list) if (severityRank(s) > severityRank(best)) best = s as AlertSeverity
  return best
}

/** An incident has three levels; INFO and WARNING collapse into the lowest. */
export function incidentSeverityOf(s: string): 'MINOR' | 'MAJOR' | 'CRITICAL' {
  if (s === 'CRITICAL') return 'CRITICAL'
  if (s === 'MAJOR') return 'MAJOR'
  return 'MINOR'
}
