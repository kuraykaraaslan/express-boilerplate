/**
 * The webhook events notification_log emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const NOTIFICATION_LOG_WEBHOOK_EVENTS = [
  'notification.failure_rate_high',
] as const;

export type NotificationLogWebhookEvent = (typeof NOTIFICATION_LOG_WEBHOOK_EVENTS)[number];

export default NOTIFICATION_LOG_WEBHOOK_EVENTS;
