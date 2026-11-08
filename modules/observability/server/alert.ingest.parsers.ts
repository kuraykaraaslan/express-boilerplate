import { z } from 'zod'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { ALERT_SEVERITY_ORDER, severityRank, type AlertSeverity, type AlertSource, type IntegrationKind } from './alert.enums'
import { sanitizeLabels } from './alert.matchers'

/**
 * What an outside sender may say, turned into the pipeline's own signal (observability phase 11).
 *
 * The sender is untrusted. It chooses labels, annotations, a title and a severity, and nothing else: the tenant comes from the
 * integration key, the source is fixed by the integration, and the severity is clamped to the ceiling the integration was created with,
 * so a leaked key cannot page the whole company at CRITICAL. Anything malformed is dropped or refused; nothing here throws on odd input
 * except the one case a caller must hear about (a body that is not the format at all).
 */

export interface AlertSignal {
  source: AlertSource
  /** Which integration or module sent it. */
  sourceRef?: string | null
  title: string
  severity: AlertSeverity
  status: 'FIRING' | 'RESOLVED'
  labels: Record<string, string>
  annotations: Record<string, string>
  /** The sender's own fingerprint, when it has one. */
  fingerprint?: string | null
  startsAt?: Date | null
  endsAt?: Date | null
  /** A planned window explains this signal: stored, but never announced. */
  duringMaintenance?: boolean
  /** Compatibility hint for the incident an auto-opened group should keep tying to (a monitor's single open incident). */
  monitorId?: string | null
}

export const MAX_ALERTS_PER_PAYLOAD = 500
export const MAX_TITLE = 300
export const MAX_ANNOTATION = 2000

const SEVERITY_WORDS: Record<string, AlertSeverity> = {
  critical: 'CRITICAL', crit: 'CRITICAL', page: 'CRITICAL', p1: 'CRITICAL', sev1: 'CRITICAL', fatal: 'CRITICAL', emergency: 'CRITICAL',
  major: 'MAJOR', high: 'MAJOR', error: 'MAJOR', p2: 'MAJOR', sev2: 'MAJOR',
  minor: 'MINOR', medium: 'MINOR', p3: 'MINOR', sev3: 'MINOR',
  warning: 'WARNING', warn: 'WARNING', low: 'WARNING', p4: 'WARNING', sev4: 'WARNING',
  info: 'INFO', informational: 'INFO', notice: 'INFO', debug: 'INFO', none: 'INFO',
}

/** Words senders use, to our ladder. Unknown or missing reads as WARNING: loud enough to see, not loud enough to page. */
export function severityFromText(raw: unknown, fallback: AlertSeverity = 'WARNING'): AlertSeverity {
  if (typeof raw !== 'string') return fallback
  const exact = ALERT_SEVERITY_ORDER.find((s) => s === raw.trim().toUpperCase())
  if (exact) return exact
  return SEVERITY_WORDS[raw.trim().toLowerCase()] ?? fallback
}

/** A sender never gets to be louder than the ceiling its integration was created with. */
export function clampSeverity(s: AlertSeverity, ceiling: string): AlertSeverity {
  return severityRank(s) > severityRank(ceiling) ? (ALERT_SEVERITY_ORDER[severityRank(ceiling)] ?? 'WARNING') : s
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  // Alertmanager sends 0001-01-01T00:00:00Z for "no end time yet".
  if (v.startsWith('0001-')) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function strings(raw: unknown, max = MAX_ANNOTATION): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 30) break
    if (typeof v === 'string' && k !== '__proto__') out[k.slice(0, 64)] = v.slice(0, max)
  }
  return out
}

function firingStatus(v: unknown): 'FIRING' | 'RESOLVED' {
  return typeof v === 'string' && v.toLowerCase() === 'resolved' ? 'RESOLVED' : 'FIRING'
}

// ---- Alertmanager / Grafana ------------------------------------------------------------------------------------------------

/** Alertmanager webhook v4 (Grafana's webhook contact point sends the same shape). */
export function parseAlertmanager(body: unknown, source: AlertSource, sourceRef: string | null): AlertSignal[] {
  const alerts = (body as { alerts?: unknown })?.alerts
  if (!Array.isArray(alerts)) throw new AppError('Expected an Alertmanager payload with an `alerts` list', 400, ErrorCode.VALIDATION_ERROR)
  const out: AlertSignal[] = []
  for (const a of alerts.slice(0, MAX_ALERTS_PER_PAYLOAD)) {
    if (!a || typeof a !== 'object') continue
    const alert = a as Record<string, unknown>
    const labels = sanitizeLabels(alert.labels)
    const annotations = strings(alert.annotations)
    const title = (labels.alertname ?? annotations.summary ?? annotations.title ?? 'Alert').slice(0, MAX_TITLE)
    out.push({
      source, sourceRef, title,
      severity: severityFromText(labels.severity),
      status: firingStatus(alert.status),
      labels, annotations,
      fingerprint: typeof alert.fingerprint === 'string' ? alert.fingerprint : null,
      startsAt: parseDate(alert.startsAt), endsAt: parseDate(alert.endsAt),
    })
  }
  return out
}

// ---- generic ----------------------------------------------------------------------------------------------------------------

const GenericAlertSchema = z.object({
  title: z.string().min(1).max(MAX_TITLE),
  severity: z.string().max(20).optional(),
  status: z.string().max(20).optional(),
  labels: z.unknown().optional(),
  annotations: z.unknown().optional(),
  description: z.string().max(MAX_ANNOTATION).optional(),
  fingerprint: z.string().max(200).nullish(),
  startsAt: z.string().max(40).optional(),
  endsAt: z.string().max(40).optional(),
})

/** `{ title, severity?, status?, labels?, annotations?, fingerprint? }`, or `{ alerts: [ … ] }` of those. */
export function parseGeneric(body: unknown, source: AlertSource, sourceRef: string | null): AlertSignal[] {
  const list = Array.isArray((body as { alerts?: unknown })?.alerts) ? ((body as { alerts: unknown[] }).alerts) : [body]
  if (list.length === 0) throw new AppError('No alerts in the payload', 400, ErrorCode.VALIDATION_ERROR)
  const out: AlertSignal[] = []
  for (const item of list.slice(0, MAX_ALERTS_PER_PAYLOAD)) {
    const r = GenericAlertSchema.safeParse(item)
    if (!r.success) throw new AppError(`Invalid alert: ${r.error.issues[0]?.path.join('.') || 'body'}: ${r.error.issues[0]?.message}`, 400, ErrorCode.VALIDATION_ERROR)
    const a = r.data
    const annotations = strings(a.annotations)
    if (a.description && !annotations.description) annotations.description = a.description
    out.push({
      source, sourceRef, title: a.title,
      severity: severityFromText(a.severity),
      status: firingStatus(a.status),
      labels: sanitizeLabels(a.labels), annotations,
      fingerprint: a.fingerprint ?? null,
      startsAt: parseDate(a.startsAt), endsAt: parseDate(a.endsAt),
    })
  }
  return out
}

/** Pick the parser by the integration's kind. The sender cannot choose its own. */
export function parseIngest(kind: IntegrationKind, body: unknown, sourceRef: string | null): AlertSignal[] {
  return kind === 'GENERIC' ? parseGeneric(body, 'integration', sourceRef) : parseAlertmanager(body, 'integration', sourceRef)
}
