/**
 * The production dependencies of the MCP route. Authentication reuses the tenant guard's API key lane (phase 48 D48-1, D48-2): the key
 * verifies as on every module route (active, unexpired, its tenant ACTIVE, its holder an ACTIVE member, the IP lists, its rate limit),
 * must be a key of the URL's tenant, must hold `mcp_server.connect` (D57-15), and acts as its holder. MCP keys are API keys (owner
 * direction 2026-11-05): created, rotated and revoked on the API keys page, never here.
 */
import type { NextRequest } from 'next/server';
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import { carriesApiKey } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.api-key.next';
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.granted.next';
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next';
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types';
import { MCP_CONNECT_PERMISSION } from './mcp_server.protocol';
import { toolRegistry } from './registry/mcp_server.registry';
import { defaultToolCallDeps } from './mcp_server.calls';
import { getMcpPolicy } from './mcp_server.settings-policy';
import { mcpUrls, resourceCovers } from './oauth/mcp_oauth.urls';
import type { McpHttpDeps } from './mcp_server.http';

const KIND_SCOPE: Record<'read' | 'write', string> = { read: 'mcp:read', write: 'mcp:write' };

export const defaultMcpHttpDeps: McpHttpDeps = {
  async authenticate(request, tenantId, moduleId) {
    // The guard decides first, as on every tenant route; this route alone accepts an MCP grant token (allowMcpGrant).
    const auth = (await authorizeRequest({
      request: request as NextRequest, tenantId, requiredPermission: MCP_CONNECT_PERMISSION, scope: 'TENANT', allowMcpGrant: true,
    })) as TenantAuthResult;
    const granted = (permissionIds: string[]) => grantedPermissions({ request: request as NextRequest, tenantId, permissionIds, session: auth });
    if (auth.apiKey && carriesApiKey(request)) {
      return { caller: { tenantId, userId: auth.user.userId, via: 'api_key', credentialId: auth.apiKey.apiKeyId, memberRole: auth.tenantMember?.memberRole }, granted, allowsKind: () => true };
    }
    if (auth.mcpGrant) {
      const urls = await mcpUrls(tenantId);
      // RFC 8707: a token consented for one server (or the workspace's MCP base) is no credential for another server.
      if (!resourceCovers(urls, auth.mcpGrant.resource, moduleId)) throw new AppError('The access token is not for this MCP server', 401, ErrorCode.UNAUTHORIZED);
      const scopes = new Set(auth.mcpGrant.scope.split(' '));
      return {
        caller: { tenantId, userId: auth.user.userId, via: 'oauth', credentialId: auth.mcpGrant.grantId, memberRole: auth.tenantMember?.memberRole },
        granted, allowsKind: (kind) => scopes.has(KIND_SCOPE[kind]),
      };
    }
    // A cookie session, or anything else the guard let through: MCP takes an API key or an OAuth access token.
    throw new AppError('An API key or an access token is required', 401, ErrorCode.UNAUTHORIZED);
  },
  async challenge(tenantId, moduleId) {
    const urls = await mcpUrls(tenantId);
    return `Bearer realm="mcp", resource_metadata="${urls.protectedResourceMetadata(moduleId)}", scope="mcp:read"`;
  },
  async toolsOf(moduleId) {
    return (await toolRegistry()).catalog.get(moduleId) ?? null;
  },
  async moduleEnabled(tenantId, moduleId) {
    return (await getEnabledModuleIds(tenantId)).has(moduleId);
  },
  policy: getMcpPolicy,
  calls: defaultToolCallDeps,
};
