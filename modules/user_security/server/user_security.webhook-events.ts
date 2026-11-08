/**
 * The webhook events user_security emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
// Phase 55 00.4: `security.login_anomaly` is user_session's (the one login-anomaly detector); user_security no longer sends it.
export const USER_SECURITY_WEBHOOK_EVENTS = [
  'security.mfa_enabled',
  'security.mfa_disabled',
] as const;

export type UserSecurityWebhookEvent = (typeof USER_SECURITY_WEBHOOK_EVENTS)[number];

export default USER_SECURITY_WEBHOOK_EVENTS;
