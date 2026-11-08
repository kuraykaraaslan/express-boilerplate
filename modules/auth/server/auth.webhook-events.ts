/**
 * The webhook events auth emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const AUTH_WEBHOOK_EVENTS = [
  'auth.account_locked',
] as const;

export type AuthWebhookEvent = (typeof AUTH_WEBHOOK_EVENTS)[number];

export default AUTH_WEBHOOK_EVENTS;
