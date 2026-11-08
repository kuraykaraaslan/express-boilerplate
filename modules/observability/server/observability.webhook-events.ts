/**
 * The webhook events observability emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const OBSERVABILITY_WEBHOOK_EVENTS = [
  'alert.firing',
  'alert.resolved',
  'alert.acknowledged',
  'slo.budget_low',
  'slo.budget_exhausted',
  'incident.opened',
  'incident.updated',
  'incident.resolved',
  'incident.postmortem_published',
  'status.component_changed',
  'observability.config_applied',
] as const;

export type ObservabilityWebhookEvent = (typeof OBSERVABILITY_WEBHOOK_EVENTS)[number];

export default OBSERVABILITY_WEBHOOK_EVENTS;
