/**
 * Where "the modules changed for this tenant" is announced (docs/phases/37-extensions/05): tenant_setting publishes when a
 * module's activation or the platform's ban list is written, and every open admin session hears it over the stream it
 * already holds, then reloads what the module set shapes (menus, slots, blocks). `'*'` is every tenant (a ROOT write).
 * Import-free on purpose: the settings cache imports it.
 */
export const extensionStateChannel = (tenantId: string | '*'): string => `extensions:state:${tenantId}`;

/** The event name the stream forwards it under (common/ui's extension-state-refresh repeats it for the browser). */
export const EXTENSION_STATE_EVENT = 'extensions.state';
