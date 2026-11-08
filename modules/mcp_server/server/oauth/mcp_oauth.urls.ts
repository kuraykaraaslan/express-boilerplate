/**
 * The public URLs of a workspace's MCP surface, as a client addresses them (docs/phases/57-mcp-server D57-8): the tenant's own origin in
 * domain tenancy, the platform host with the tenant prefix otherwise (`absoluteTenantUrl`). The issuer, the resource indicators and the
 * metadata documents are all derived from it, so what the client is told and what the server checks are the same strings.
 */
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url';

export interface McpUrls {
  /** The workspace's MCP base: `<origin>/api/mcp`. A resource indicator may be this or one server under it. */
  base: string;
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  revocationEndpoint: string;
  /** RFC 9728 metadata of one server. */
  protectedResourceMetadata(moduleId: string): string;
  /** The canonical URI of one server (the resource a client names for it). */
  serverResource(moduleId: string): string;
}

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export async function mcpUrls(tenantId: string): Promise<McpUrls> {
  const [base, authorize] = await Promise.all([absoluteTenantUrl(tenantId, '/api/mcp'), absoluteTenantUrl(tenantId, '/admin/mcp/authorize')]);
  const b = trimSlash(base);
  return {
    base: b,
    issuer: `${b}/oauth`,
    authorizationEndpoint: authorize,
    tokenEndpoint: `${b}/oauth/token`,
    revocationEndpoint: `${b}/oauth/revoke`,
    protectedResourceMetadata: (moduleId) => `${b}/oauth/protected-resource/${moduleId}`,
    serverResource: (moduleId) => `${b}/${moduleId}`,
  };
}

const MODULE_SEGMENT = /^[a-z][a-z0-9_]{0,63}$/;

/** A resource indicator this workspace serves: its MCP base or one server under it (the server's module id), or null. */
export function servedResource(urls: Pick<McpUrls, 'base'>, resource: string | null | undefined): { resource: string; moduleId: string | null } | null {
  if (typeof resource !== 'string' || resource.length > 512) return null;
  const r = trimSlash(resource.trim());
  if (r === urls.base) return { resource: r, moduleId: null };
  if (!r.startsWith(`${urls.base}/`)) return null;
  const rest = r.slice(urls.base.length + 1);
  return MODULE_SEGMENT.test(rest) && rest !== 'oauth' && rest !== 'grants' ? { resource: r, moduleId: rest } : null;
}

/** Whether a grant consented for `resource` covers the server of `moduleId` (the base covers every server). */
export function resourceCovers(urls: Pick<McpUrls, 'base'>, resource: string, moduleId: string): boolean {
  const served = servedResource(urls, resource);
  return !!served && (served.moduleId === null || served.moduleId === moduleId);
}
