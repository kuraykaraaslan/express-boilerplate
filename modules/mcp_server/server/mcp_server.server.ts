/**
 * The one server factory (auth-and-token-patterns.md §2.3.9): a fresh McpServer per request for one module's tools and one verified
 * caller (stateless, 4.2; nothing per caller at module scope, F12). The legacy shim is off (F10): no server-initiated requests.
 * Every list varies by the caller, so every cache hint is private (F14, gate P4).
 */
import { McpServer } from '@modelcontextprotocol/server';
import type { McpCaller, McpToolDefinition } from '@kuraykaraaslan-labs/common/server/common.mcp-contracts';
import { MCP_SERVER_VERSION } from './mcp_server.protocol';
import { registerGuardedTool, type ToolCallDeps } from './mcp_server.register';

export const CACHE_HINTS = {
  'tools/list': { ttlMs: 0, cacheScope: 'private' },
} as const;

export function buildServer(
  moduleId: string, tools: readonly McpToolDefinition[], caller: McpCaller, granted: ReadonlySet<string>, deps: ToolCallDeps,
): McpServer {
  const server = new McpServer(
    { name: `nb-${moduleId}`, version: MCP_SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } }, inputRequired: { legacyShim: false }, cacheHints: CACHE_HINTS },
  );
  for (const tool of tools) registerGuardedTool(server, moduleId, tool, caller, granted, deps);
  return server;
}
