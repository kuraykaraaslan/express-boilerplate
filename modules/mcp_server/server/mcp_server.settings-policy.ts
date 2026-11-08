import SettingService from '@kuraykaraaslan-labs/tenant_setting/server/tenant_setting.service';
import { MCP_SETTING_KEYS } from './mcp_server.setting.keys';
import { parseClientHosts } from './oauth/mcp_oauth.client';

/**
 * The workspace's MCP policy (Settings → MCP). It decides access, so it fails CLOSED: unset, a bad value or a failed settings read
 * means MCP is off for the workspace (MO-5: off until an admin switches it on).
 *
 * - `mcpEnabled` ('true' | 'false', default false): MCP clients may connect.
 * - `mcpDisabledTools`: `<server>/<tool>` entries separated by new lines, commas or spaces; anything else is ignored. A disabled tool is
 *   not listed and cannot be called, whatever the credential holds.
 * - `mcpAllowedClientHosts`: client hosts accepted over OAuth beside the platform's known clients (one per line).
 */
export interface McpPolicy {
  enabled: boolean;
  disabledTools: ReadonlySet<string>;
  allowedClientHosts: ReadonlySet<string>;
}

const ENTRY = /^[a-z][a-z0-9_]*\/[a-z][a-z0-9_]*$/;
const MAX_ENTRIES = 500;

export const MCP_POLICY_OFF: McpPolicy = Object.freeze({ enabled: false, disabledTools: new Set<string>(), allowedClientHosts: new Set<string>() });

export function parseDisabledTools(value: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const raw of (value ?? '').split(/[\s,]+/)) {
    const entry = raw.trim().toLowerCase();
    if (ENTRY.test(entry)) out.add(entry);
    if (out.size >= MAX_ENTRIES) break;
  }
  return out;
}

export function policyFromSettings(s: Record<string, string | null | undefined>): McpPolicy {
  return {
    enabled: (s[MCP_SETTING_KEYS.ENABLED] ?? '').trim().toLowerCase() === 'true',
    disabledTools: parseDisabledTools(s[MCP_SETTING_KEYS.DISABLED_TOOLS]),
    allowedClientHosts: parseClientHosts(s[MCP_SETTING_KEYS.ALLOWED_CLIENT_HOSTS]),
  };
}

export async function getMcpPolicy(tenantId: string): Promise<McpPolicy> {
  try {
    return policyFromSettings(await SettingService.getByKeys(tenantId, [MCP_SETTING_KEYS.ENABLED, MCP_SETTING_KEYS.DISABLED_TOOLS, MCP_SETTING_KEYS.ALLOWED_CLIENT_HOSTS]) ?? {});
  } catch {
    return MCP_POLICY_OFF;
  }
}

/** The key of a tool in `mcpDisabledTools`. */
export const toolKey = (moduleId: string, toolName: string) => `${moduleId}/${toolName}`;
