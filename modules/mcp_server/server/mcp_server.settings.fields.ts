import type { SettingFieldDef } from '@kuraykaraaslan-labs/tenant_setting/server/setting-fields.types';

// UI metadata for Settings → MCP. Each key is read by mcp_server.settings-policy.ts (getMcpPolicy) on every MCP request.
export const MCP_SETTINGS_FIELDS: SettingFieldDef[] = [
  {
    key: 'mcpEnabled',
    label: 'Let MCP clients connect',
    description: 'AI apps (Claude, Cursor, VS Code and others) may connect to this workspace with an API key that holds "Connect MCP clients". Each tool still needs its own permission, held by the key and by its owner. Off by default.',
    group: 'Access',
    type: 'boolean',
    defaultValue: 'false',
  },
  {
    key: 'mcpDisabledTools',
    label: 'Switched-off tools',
    description: 'Tools no one in this workspace may use, one per line as server/tool, for example tasks/get_task. The list of servers and tools is at /api/mcp.',
    group: 'Access',
    type: 'textarea',
    defaultValue: '',
  },
  {
    key: 'mcpAllowedClientHosts',
    label: 'More AI apps',
    description: 'Hosts of AI apps that may connect with a sign-in (OAuth) beside the known ones (Claude, ChatGPT, Cursor, VS Code, GitHub), one per line, for example tools.example.com.',
    group: 'Access',
    type: 'textarea',
    defaultValue: '',
  },
];
