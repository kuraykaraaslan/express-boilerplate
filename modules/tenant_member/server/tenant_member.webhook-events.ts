/**
 * The webhook events tenant_member emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const TENANT_MEMBER_WEBHOOK_EVENTS = [
  'member.created',
  'member.updated',
  'member.deleted',
] as const;

export type TenantMemberWebhookEvent = (typeof TENANT_MEMBER_WEBHOOK_EVENTS)[number];

export default TENANT_MEMBER_WEBHOOK_EVENTS;
