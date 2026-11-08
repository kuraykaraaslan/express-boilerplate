import Logger from '@kuraykaraaslan-labs/logger'

/**
 * Observability lifecycle events beyond the alert, incident and SLO ones that have their own emitters (observability phase 21.5):
 * `alert.acknowledged`, `incident.postmortem_published`, `status.component_changed`, `observability.config_applied`.
 *
 * Fire-and-forget, like `incident.webhook.ts`: a failing endpoint or a missing `webhook` module must never affect the thing that happened. The
 * payload is the tenant's own record sent to the tenant's own endpoints and carries identifiers and states, not free text a reader wrote.
 */
export type ObservabilityEvent = 'alert.acknowledged' | 'incident.postmortem_published' | 'status.component_changed' | 'observability.config_applied'

export function emitObservabilityEvent(tenantId: string, event: ObservabilityEvent, payload: Record<string, unknown>): void {
  void (async () => {
    try {
      const { default: WebhookService } = await import('@kuraykaraaslan-labs/webhook/server/webhook.service')
      await WebhookService.dispatchEvent(tenantId, event, payload)
    } catch (err) {
      Logger.debug?.(`[observability.events] ${event} not delivered: ${err instanceof Error ? err.message : String(err)}`)
    }
  })()
}
