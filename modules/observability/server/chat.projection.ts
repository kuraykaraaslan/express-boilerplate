import { PUBLIC_CHAT_EVENTS, type ChatEvent, type ChatMessageModel, type ChatSeverity } from './chat.format'
import { redactSecrets } from './chat.destination'

/**
 * What a destination may KNOW about an incident (observability phase 14.7). Pure. This is the privacy choke point of the chat posts: the
 * renderers in `chat.format.ts` draw whatever model they are given; this file decides which model a destination gets, or none.
 *
 *  - A destination flagged `PUBLIC` is judged by the public status page's own rule: only an incident that IS public, only its public
 *    words (title, severity, public message, the PUBLIC components it touches), only the events the page itself shows, and a link to the
 *    status page. A private incident, an acknowledgement, a mitigation, the internal reason and the console link never reach it.
 *  - An `INTERNAL` destination (the responders' channel) gets every incident, with the console link and, on the opening post, the
 *    reason (secrets redacted). Neither audience ever receives a token, a key, a user id or a monitor id.
 */

export type ChatAudience = 'INTERNAL' | 'PUBLIC'

export interface IncidentFacts {
  incidentId: string
  title: string
  severity: string
  status: string
  isPublic: boolean
  publicMessage?: string | null
  reason?: string | null
  affectedComponentIds?: string[] | null
}

export interface ComponentFact { name: string; isPublic: boolean }

export interface ProjectionContext {
  event: ChatEvent
  audience: ChatAudience
  incident: IncidentFacts
  components: ReadonlyMap<string, ComponentFact>
  /** The admin console link of the incident (built by the platform). */
  consoleUrl: string | null
  /** The public status page link. */
  statusUrl: string | null
  /** The words of the public progress update this event is about, when it is one. */
  updateMessage?: string | null
  /** The incident was private a moment ago and has just been published. */
  becamePublic?: boolean
}

export type WebhookIncidentEvent = 'incident.opened' | 'incident.updated' | 'incident.resolved'

/** The webhook module's incident events and the `change` they carry, as the chat vocabulary. */
export function toChatEvent(event: WebhookIncidentEvent, change?: string | null): ChatEvent {
  if (change === 'postmortem_published') return 'incident.postmortem_published'
  if (event === 'incident.opened') return 'incident.created'
  if (event === 'incident.resolved') return 'incident.resolved'
  if (change === 'acknowledged') return 'incident.acknowledged'
  if (change === 'mitigated') return 'incident.mitigated'
  return 'incident.updated'
}

const HEADLINE: Record<ChatEvent, string> = {
  'incident.created': 'Incident opened',
  'incident.updated': 'Incident updated',
  'incident.acknowledged': 'Incident acknowledged',
  'incident.mitigated': 'Impact mitigated',
  'incident.resolved': 'Incident resolved',
  'incident.postmortem_published': 'Post-mortem published',
}

const severityOf = (s: string): ChatSeverity | null => (s === 'MINOR' || s === 'MAJOR' || s === 'CRITICAL' ? s : null)

/** Does this destination want this event and severity at all? (Audience rules are applied by `projectIncidentMessage`.) */
export function wantsEvent(dest: { audience: string; events?: string[] | null; severities?: string[] | null }, event: ChatEvent, severity: string): boolean {
  if (dest.audience === 'PUBLIC' && !PUBLIC_CHAT_EVENTS.includes(event)) return false
  if (dest.events && dest.events.length > 0 && !dest.events.includes(event)) return false
  if (dest.severities && dest.severities.length > 0 && !dest.severities.includes(severity)) return false
  return true
}

export function projectIncidentMessage(ctx: ProjectionContext): ChatMessageModel | null {
  const { incident, audience } = ctx
  const names = (ids: string[] | null | undefined, publicOnly: boolean): string[] =>
    (ids ?? []).map((id) => ctx.components.get(id)).filter((c): c is ComponentFact => Boolean(c) && (!publicOnly || c!.isPublic)).map((c) => c.name)

  if (audience === 'PUBLIC') {
    if (!incident.isPublic) return null
    if (!PUBLIC_CHAT_EVENTS.includes(ctx.event)) return null
    // First publication reads as an opening, which is what the page's subscribers are told too.
    const kind: ChatEvent = ctx.becamePublic && ctx.event === 'incident.updated' ? 'incident.created' : ctx.event
    return {
      kind,
      headline: ctx.becamePublic && kind === 'incident.created' ? 'Incident published' : HEADLINE[kind],
      title: incident.title, severity: severityOf(incident.severity), status: incident.status,
      components: names(incident.affectedComponentIds, true),
      body: ctx.updateMessage ?? incident.publicMessage ?? null,
      linkUrl: ctx.statusUrl, linkLabel: 'View status page',
    }
  }

  const reason = ctx.event === 'incident.created' && incident.reason ? redactSecrets(incident.reason).slice(0, 300) : null
  return {
    kind: ctx.event, headline: HEADLINE[ctx.event],
    title: incident.title, severity: severityOf(incident.severity), status: incident.status,
    components: names(incident.affectedComponentIds, false),
    body: ctx.updateMessage ?? reason,
    linkUrl: ctx.consoleUrl, linkLabel: 'Open incident',
    footer: incident.isPublic ? null : 'Private incident: not shown on the status page.',
  }
}
