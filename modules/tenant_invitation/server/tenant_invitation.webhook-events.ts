/**
 * The webhook events tenant_invitation emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const TENANT_INVITATION_WEBHOOK_EVENTS = [
  'invitation.sent',
  'invitation.accepted',
  'invitation.declined',
  'invitation.revoked',
] as const;

export type TenantInvitationWebhookEvent = (typeof TENANT_INVITATION_WEBHOOK_EVENTS)[number];

export default TENANT_INVITATION_WEBHOOK_EVENTS;
