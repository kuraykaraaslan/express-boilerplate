import Logger from '@kuraykaraaslan-labs/logger'
import type { Incident } from './entities/incident.entity'

/**
 * Incident lifecycle events for webhooks and automation flows (observability phase 14): `incident.opened`, `incident.updated`,
 * `incident.resolved`. Fire-and-forget: a failing endpoint or a missing webhook module must never affect the incident. The payload is the
 * tenant's own record sent to the tenant's own endpoints; what an incident says about the public page is its `isPublic` flag, nothing more.
 */
export type IncidentWebhookEvent = 'incident.opened' | 'incident.updated' | 'incident.resolved'

export function incidentPayload(i: Pick<Incident, 'incidentId' | 'title' | 'severity' | 'status' | 'isPublic' | 'isAuto' | 'monitorId' | 'startedAt' | 'resolvedAt' | 'reason' | 'acknowledgedAt' | 'mitigatedAt'>, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    incidentId: i.incidentId, title: i.title, severity: i.severity, status: i.status, isPublic: i.isPublic, isAuto: i.isAuto,
    monitorId: i.monitorId ?? null, reason: i.reason ?? null, startedAt: i.startedAt, resolvedAt: i.resolvedAt ?? null,
    acknowledgedAt: i.acknowledgedAt ?? null, mitigatedAt: i.mitigatedAt ?? null, ...extra,
  }
}

/** What the optional Slack / Teams posts need beyond the webhook payload: the words of a public update, and whether this edit published the incident. */
export interface IncidentChatHint { updateMessage?: string | null; becamePublic?: boolean }

export function emitIncidentWebhook(
  tenantId: string, event: IncidentWebhookEvent,
  incident: Parameters<typeof incidentPayload>[0] & Partial<Pick<Incident, 'publicMessage' | 'affectedComponentIds'>>,
  extra: Record<string, unknown> = {}, chat: IncidentChatHint = {},
): void {
  // Slack and Teams posts (phase 14.7) ride the same lifecycle moments. Their own failure domain: nothing here can fail the incident or the webhook.
  void (async () => {
    try {
      const { default: ChatService } = await import('./chat.service')
      await ChatService.dispatchIncident({
        tenantId, event, change: typeof extra.change === 'string' ? extra.change : null,
        incident: {
          incidentId: incident.incidentId, title: incident.title, severity: incident.severity, status: incident.status, isPublic: incident.isPublic,
          publicMessage: incident.publicMessage ?? null, reason: incident.reason ?? null, affectedComponentIds: incident.affectedComponentIds ?? null,
        },
        updateMessage: chat.updateMessage ?? null, becamePublic: chat.becamePublic ?? false,
      })
    } catch (err) {
      Logger.debug?.(`[incident.webhook] ${event} not posted to chat: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
  void (async () => {
    try {
      const { default: WebhookService } = await import('@kuraykaraaslan-labs/webhook/server/webhook.service')
      await WebhookService.dispatchEvent(tenantId, event, incidentPayload(incident, extra))
    } catch (err) {
      Logger.debug?.(`[incident.webhook] ${event} not delivered: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}
