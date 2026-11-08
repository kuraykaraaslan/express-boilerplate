/**
 * The webhook events tenant_usage emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const TENANT_USAGE_WEBHOOK_EVENTS = [
  'usage.threshold',
  'usage.overage',
] as const;

export type TenantUsageWebhookEvent = (typeof TENANT_USAGE_WEBHOOK_EVENTS)[number];

export default TENANT_USAGE_WEBHOOK_EVENTS;
