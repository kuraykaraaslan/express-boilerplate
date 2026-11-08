/**
 * Default ports of the credential-less **local** supervisors' own `/healthz`, `/metrics` and `/supervisor` (07 task 7), in
 * one table so no two kinds clash and the relay (`supervisor.relay.ts`) finds them without importing the kinds' modules.
 * Next to the kinds' service ports: the script host serves 4012 (its supervisor 4015; 4013 is the automation-worker's
 * health port and 4014 the ws supervisor's, `WS_SUPERVISOR_PORT`), the plugin host 4500 (its supervisor 4501). Each is
 * overridable by the kind's env key (`AUTOMATION_SCRIPT_HOST_SUPERVISOR_PORT`, `PLUGIN_HOST_SUPERVISOR_PORT`).
 */
export const LOCAL_SUPERVISOR_PORTS = {
  'script-host': 4015,
  'plugin-host': 4501,
} as const satisfies Record<string, number>;
