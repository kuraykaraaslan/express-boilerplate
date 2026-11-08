/**
 * The webhook events api_key emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const API_KEY_WEBHOOK_EVENTS = [
  'api_key.created',
  'api_key.updated',
  'api_key.deleted',
  'api_key.expired',
  'api_key.expiring',
  'api_key.rotated',
  'api_key.anomaly_detected',
] as const;

export type ApiKeyWebhookEvent = (typeof API_KEY_WEBHOOK_EVENTS)[number];

export default API_KEY_WEBHOOK_EVENTS;
