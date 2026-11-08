import type { Incident } from './entities/incident.entity'
import type { IncidentEvent } from './entities/incident_event.entity'

/**
 * The post-mortem's starting text (observability phase 14): the timeline as plain, editable lines. Pure. Blameless by construction: a line
 * says WHAT happened and when, and never names a person; who acted is on the timeline itself for the people who need it.
 */

const LABELS: Record<string, (d: Record<string, unknown>) => string> = {
  DECLARED: (d) => (d.auto ? 'The incident was opened automatically' : 'The incident was declared'),
  ALERT_LINKED: (d) => `Alert: ${String(d.title ?? 'unnamed alert')}`,
  ACKNOWLEDGED: () => 'The incident was acknowledged',
  MITIGATED: () => 'The impact was mitigated',
  RESOLVED: () => 'The incident was resolved',
  SEVERITY_CHANGED: (d) => `Severity changed from ${String(d.from)} to ${String(d.to)}`,
  PUBLISHED: () => 'The incident was published to the status page',
  UNPUBLISHED: () => 'The incident was withdrawn from the status page',
  PUBLIC_UPDATE: (d) => `Public update posted (${String(d.status)})`,
  ROLE_ASSIGNED: (d) => `A ${String(d.role).toLowerCase()} was assigned`,
  TASK_ADDED: (d) => `Follow-up added: ${String(d.title ?? '')}`,
  POSTMORTEM: (d) => `Post-mortem ${String(d.status ?? 'updated').toLowerCase()}`,
  AI_NOTE: () => 'An automated analysis was added',
}

const SKIPPED = new Set(['ROLE_REMOVED', 'NOTE_ADDED'])

function stamp(d: Date): string {
  return new Date(d).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export function buildTimelineText(incident: Pick<Incident, 'startedAt' | 'title'>, events: readonly Pick<IncidentEvent, 'type' | 'data' | 'createdAt'>[]): string {
  const lines = events
    .filter((e) => !SKIPPED.has(e.type) && LABELS[e.type])
    .map((e) => `- ${stamp(e.createdAt)}: ${LABELS[e.type]((e.data ?? {}) as Record<string, unknown>)}`)
  return [`- ${stamp(incident.startedAt)}: Impact began (${incident.title})`, ...lines.filter((l) => !l.includes('The incident was opened automatically') && !l.includes('The incident was declared'))].join('\n')
}

export function humanDuration(ms: number): string {
  const m = Math.max(0, Math.round(ms / 60_000))
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`
  const h = Math.floor(m / 60); const rest = m % 60
  return `${h} hour${h === 1 ? '' : 's'}${rest ? ` ${rest} minute${rest === 1 ? '' : 's'}` : ''}`
}

/** A one-paragraph summary the author edits: severity, the title and, when known, how long it lasted. */
export function buildSummary(incident: Pick<Incident, 'title' | 'severity' | 'startedAt' | 'resolvedAt'>): string {
  const lasted = incident.resolvedAt ? ` It lasted ${humanDuration(new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime())}.` : ''
  return `${incident.severity} incident: ${incident.title}.${lasted}`.slice(0, 2000)
}

const section = (heading: string, body: string | null | undefined): string[] => (body?.trim() ? [`## ${heading}`, '', body.trim(), ''] : [])

/**
 * The published post-mortem as one Markdown document (what the `document` module stores as a version). Pure. The write-up stays the
 * content source: this only lays out the fields the author wrote, in the fixed order of the template (impact, timeline, root cause,
 * contributing factors, what went well, what went poorly). Blameless by construction: the author and reviewer ids are not printed.
 */
export function renderPostmortemMarkdown(
  incident: Pick<Incident, 'title' | 'severity' | 'startedAt' | 'resolvedAt'>,
  pm: { summary?: string | null; impact?: string | null; timelineText?: string | null; rootCause?: string | null; contributingFactors?: string | null; wentWell?: string | null; wentPoorly?: string | null },
): string {
  const title = incident.title.replace(/\s+/g, ' ').trim()
  return [
    `# Post-mortem: ${title}`, '',
    `Severity: ${incident.severity} · Started: ${stamp(incident.startedAt)}${incident.resolvedAt ? ` · Resolved: ${stamp(incident.resolvedAt)}` : ''}`, '',
    ...section('Summary', pm.summary),
    ...section('Impact', pm.impact),
    ...section('Timeline', pm.timelineText),
    ...section('Root cause', pm.rootCause),
    ...section('Contributing factors', pm.contributingFactors),
    ...section('What went well', pm.wentWell),
    ...section('What went poorly', pm.wentPoorly),
  ].join('\n').trimEnd() + '\n'
}
