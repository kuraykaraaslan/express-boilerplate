/**
 * The webhook events user emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const USER_WEBHOOK_EVENTS = [
  'user.created',
  'user.updated',
  'user.deleted',
  'user.suspended',
  'user.erased',
] as const;

export type UserWebhookEvent = (typeof USER_WEBHOOK_EVENTS)[number];

export default USER_WEBHOOK_EVENTS;
