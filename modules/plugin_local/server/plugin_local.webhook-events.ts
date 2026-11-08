/**
 * The webhook events plugin_local emits, declared through `webhook:event_type` (module.json carries each event's scope, group,
 * label and description; the webhook catalogue reads only that metadata). An event that is not declared by an installed
 * module cannot be subscribed to, so a new event is added here and in module.json together.
 */
export const PLUGIN_LOCAL_WEBHOOK_EVENTS = [
  'plugin.installed',
  'plugin.uninstalled',
  'plugin.activated',
  'plugin.deactivated',
] as const;

export type PluginLocalWebhookEvent = (typeof PLUGIN_LOCAL_WEBHOOK_EVENTS)[number];

export default PLUGIN_LOCAL_WEBHOOK_EVENTS;
