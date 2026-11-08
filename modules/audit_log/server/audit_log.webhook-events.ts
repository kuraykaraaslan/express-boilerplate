/**
 * The webhook events audit_log emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const AUDIT_LOG_WEBHOOK_EVENTS = [
  'audit.high_risk',
] as const;

export type AuditLogWebhookEvent = (typeof AUDIT_LOG_WEBHOOK_EVENTS)[number];

export default AUDIT_LOG_WEBHOOK_EVENTS;
