/**
 * The server index (`GET /api/mcp`, docs/phases/57-mcp-server 57.2): which MCP servers and tools of the workspace the caller may use,
 * so a person (or a script with a key) can find the URL to give an MCP client. Plain JSON, not MCP. The same filters as the MCP route:
 * the workspace switch, modules enabled for the tenant, tools not switched off, and the caller's permissions (for a key, the key's
 * intersected with its holder's, D48-4).
 */
import type { McpToolDefinition } from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';
import { toolKey, type McpPolicy } from './mcp_server.settings-policy';

export interface McpIndexServer {
  server: string;
  /** Path of the server, relative to the workspace's API base (`/api/mcp/<server>`). */
  path: string;
  tools: { name: string; title: string; kind: 'read' | 'write' }[];
}

export interface McpIndex {
  enabled: boolean;
  servers: McpIndexServer[];
}

export async function buildMcpIndex(args: {
  policy: McpPolicy;
  catalog: ReadonlyMap<string, readonly McpToolDefinition[]>;
  enabledModules: ReadonlySet<string>;
  granted: (permissionIds: string[]) => Promise<Set<string>>;
}): Promise<McpIndex> {
  if (!args.policy.enabled) return { enabled: false, servers: [] };
  const candidates = [...args.catalog.entries()]
    .filter(([moduleId]) => args.enabledModules.has(moduleId))
    .map(([moduleId, tools]) => [moduleId, tools.filter((t) => !args.policy.disabledTools.has(toolKey(moduleId, t.name)))] as const);
  const granted = await args.granted([...new Set(candidates.flatMap(([, tools]) => tools.map((t) => t.permission)))]);
  const servers: McpIndexServer[] = [];
  for (const [moduleId, tools] of candidates) {
    const usable = tools.filter((t) => granted.has(t.permission)).map((t) => ({ name: t.name, title: t.title, kind: t.kind }));
    if (usable.length > 0) servers.push({ server: moduleId, path: `/api/mcp/${moduleId}`, tools: usable });
  }
  return { enabled: true, servers };
}
