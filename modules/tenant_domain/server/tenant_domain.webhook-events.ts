/**
 * The webhook events tenant_domain emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const TENANT_DOMAIN_WEBHOOK_EVENTS = [
  'tenant_domain.verified',
  'tenant_domain.activated',
  'tenant_domain.dns_failed',
  'tenant_domain.suspended',
  'tenant_domain.reactivated',
] as const;

export type TenantDomainWebhookEvent = (typeof TENANT_DOMAIN_WEBHOOK_EVENTS)[number];

export default TENANT_DOMAIN_WEBHOOK_EVENTS;
