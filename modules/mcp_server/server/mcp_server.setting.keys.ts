import { z } from 'zod';

/**
 * Per-tenant setting keys of mcp_server (Settings → MCP; docs/phases/57-mcp-server MO-5, D57-6). Read by mcp_server.settings-policy.ts,
 * shown by mcp_server.settings.fields.ts, owned in tenant_setting.key-owners.ts (only `mcp_server.settings.manage` reads or writes them).
 *
 * - `mcpEnabled`: MCP clients may connect to the workspace at all. Off until an admin switches it on.
 * - `mcpDisabledTools`: tools switched off for the workspace, `<server>/<tool>` one per line (`tasks/get_task`).
 * - `mcpAllowedClientHosts`: hosts of MCP clients the workspace accepts over OAuth beside the platform's known clients.
 */
export const McpServerSettingKeySchema = z.enum(['mcpEnabled', 'mcpDisabledTools', 'mcpAllowedClientHosts']);
export type McpServerSettingKey = z.infer<typeof McpServerSettingKeySchema>;
export const MCP_SERVER_KEYS = McpServerSettingKeySchema.options;

export const MCP_SETTING_KEYS = {
  ENABLED: 'mcpEnabled',
  DISABLED_TOOLS: 'mcpDisabledTools',
  ALLOWED_CLIENT_HOSTS: 'mcpAllowedClientHosts',
} as const satisfies Record<string, McpServerSettingKey>;
