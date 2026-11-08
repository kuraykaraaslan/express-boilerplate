/**
 * The webhook events tenant emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const TENANT_WEBHOOK_EVENTS = [
  'tenant.updated',
  'tenant.created',
  'tenant.deleted',
  'tenant.suspended',
] as const;

export type TenantWebhookEvent = (typeof TENANT_WEBHOOK_EVENTS)[number];

export default TENANT_WEBHOOK_EVENTS;
