/**
 * The webhook events user_social_account emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const USER_SOCIAL_ACCOUNT_WEBHOOK_EVENTS = [
  'social_account.linked',
  'social_account.unlinked',
] as const;

export type UserSocialAccountWebhookEvent = (typeof USER_SOCIAL_ACCOUNT_WEBHOOK_EVENTS)[number];

export default USER_SOCIAL_ACCOUNT_WEBHOOK_EVENTS;
