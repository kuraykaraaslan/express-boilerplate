import { z } from 'zod';

/**
 * The installation's caps on what a sandboxed plugin may ask the broker for (plugin_runtime.settings-policy.ts). Stored on and read
 * from the ROOT tenant only; each can only lower the built-in ceiling, never raise it.
 */
export const PluginRuntimeSettingKeySchema = z.enum([
  'pluginPresignMaxSeconds',
  'pluginUploadMaxMb',
  'pluginKvMaxValueKb',
]);
export type PluginRuntimeSettingKey = z.infer<typeof PluginRuntimeSettingKeySchema>;
export const PLUGIN_RUNTIME_SETTING_KEYS = PluginRuntimeSettingKeySchema.options;
