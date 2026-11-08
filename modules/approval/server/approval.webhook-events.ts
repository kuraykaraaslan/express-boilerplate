/**
 * The webhook events approval emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const APPROVAL_WEBHOOK_EVENTS = [
  'approval.submitted',
  'approval.approved',
  'approval.rejected',
  'approval.escalated',
  'approval.withdrawn',
] as const;

export type ApprovalWebhookEvent = (typeof APPROVAL_WEBHOOK_EVENTS)[number];

export default APPROVAL_WEBHOOK_EVENTS;
