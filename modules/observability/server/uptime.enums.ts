import { z } from 'zod'

/**
 * What a monitor probes. HTTP, TCP, PING and DNS are the network probes; TLS and DOMAIN watch an expiry date; HEARTBEAT is
 * push-based (the job calls us, we never call it); STEPS is a bounded multi-request API check (phase 09); BROWSER is a bounded declarative
 * browser check that runs ONLY in a browser-capable probe runner, never in the app process (phase 09, D-OBS-8).
 */
export const MonitorTypeEnum = z.enum(['HTTP', 'TCP', 'PING', 'DNS', 'TLS', 'DOMAIN', 'HEARTBEAT', 'STEPS', 'BROWSER'])
export type MonitorType = z.infer<typeof MonitorTypeEnum>

/** Debounced health state — never flipped on a single sample (see threshold logic). */
export const MonitorStatusEnum = z.enum(['UP', 'DOWN', 'DEGRADED', 'UNKNOWN'])
export type MonitorStatus = z.infer<typeof MonitorStatusEnum>

/** A single probe's outcome (a raw sample, not the debounced monitor status). */
export const CheckStatusEnum = z.enum(['UP', 'DOWN', 'DEGRADED'])
export type CheckStatus = z.infer<typeof CheckStatusEnum>

/**
 * A stored sample can also be INCONCLUSIVE: the probe could not tell (a registry without RDAP, say). It is written to the checks
 * list with its reason and then ignored by the debounce, the rollup and incidents, so "we could not look" never reads as "up".
 */
export type SampleStatus = CheckStatus | 'UNKNOWN'

export const IncidentStatusEnum = z.enum(['OPEN', 'RESOLVED'])
export type IncidentStatus = z.infer<typeof IncidentStatusEnum>

export const IncidentSeverityEnum = z.enum(['MINOR', 'MAJOR', 'CRITICAL'])
export type IncidentSeverity = z.infer<typeof IncidentSeverityEnum>

/** Customer-facing service state (phase 2): what a status page shows per
 *  component. MAINTENANCE is set by an operator (or, later, the tenant
 *  maintenance-window bridge) and is never overwritten by derivation. */
export const ComponentStatusEnum = z.enum([
  'OPERATIONAL', 'DEGRADED', 'PARTIAL_OUTAGE', 'MAJOR_OUTAGE', 'MAINTENANCE',
])
export type ComponentStatus = z.infer<typeof ComponentStatusEnum>

/** Public incident progress steps (statuspage convention). This is a STATE
 *  MACHINE HISTORY with public messages — not an activity/calendar timeline
 *  (audit §3.2): it never grows CRM-style relatedType/relatedId reach. */
export const IncidentUpdateStatusEnum = z.enum([
  'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED',
])
export type IncidentUpdateStatus = z.infer<typeof IncidentUpdateStatusEnum>
