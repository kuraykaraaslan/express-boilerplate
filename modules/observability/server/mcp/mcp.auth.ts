/**
 * MCP authentication (phase 20.1): a tenant API key from the optional `api_key` module that holds the dedicated MCP scope.
 *
 * Why not just `scopeSatisfies`: a coarse `admin` key (or `*`) would satisfy any scope, so an ordinary integration key would silently be
 * an MCP key, and an `admin` key would be an MCP WRITE key. The scopes are therefore matched EXACTLY against the key's scope list. Reads
 * need `observability:mcp:read`, writes need `observability:mcp:write` (separate, never implied, never granted by default).
 *
 * Every refusal (no header, unknown, expired, revoked, wrong scope, IP not allowed) is the same 401. A throttled key is a 429 so a client
 * backs off. The key's tenant is the tenant of the call; the URL's tenant must equal it (`assertSameTenant`), else it is the same 401.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { ifActive } from '@kuraykaraaslan-labs/common/server/extensions/optional-module';
import { ROOT_TENANT_ID } from '@kuraykaraaslan-labs/common/server/tenant-constants';
import { MCP_READ_SCOPE, MCP_WRITE_SCOPE, type McpPrincipal } from './mcp.types';

export interface McpKeyVerifier {
  /**
   * The principal of the bearer key. `tenantId` (the URL's workspace, when the route names one) pins the key: a key of another
   * tenant is refused before its rate limit or its row is touched. The key's use is not stamped here.
   */
  verify(request: { headers: { get(name: string): string | null } }, tenantId?: string): Promise<McpPrincipal>;
  /** Stamp the key's use (last used, usage count) once the route let the call through. Best effort. */
  recordUse?(request: { headers: { get(name: string): string | null } }, principal: McpPrincipal): Promise<void>;
}

export const REFUSED = () => new AppError('Invalid or unauthorized key', 401, ErrorCode.UNAUTHORIZED, { headers: { 'WWW-Authenticate': 'Bearer realm="observability-mcp"' } });

/** Pure: the principal a key's scope list grants, or null when it grants neither MCP scope. */
export function principalFromKey(key: { tenantId: string; apiKeyId: string; scopes: readonly string[]; isActive?: boolean }): McpPrincipal | null {
  if (key.isActive === false) return null;
  const canRead = key.scopes.includes(MCP_READ_SCOPE);
  const canWrite = key.scopes.includes(MCP_WRITE_SCOPE);
  if (!canRead && !canWrite) return null;
  return { tenantId: key.tenantId, apiKeyId: key.apiKeyId, canRead, canWrite };
}

export const apiKeyMcpVerifier: McpKeyVerifier = {
  async verify(request, tenantId) {
    const mod = await ifActive(ROOT_TENANT_ID, 'api_key', () => import('@kuraykaraaslan-labs/api_key/server/api_key.service'));
    if (!mod) throw new AppError('The MCP endpoint is unavailable', 503, ErrorCode.PROVIDER_UNAVAILABLE, { retryable: true });
    let key;
    try {
      // The MCP scopes are matched here, after verification, so the use is stamped only once the route let the call through.
      key = await mod.default.verifyFromAuthHeader(request, tenantId, undefined, { deferUsage: true });
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 429) throw e;
      throw REFUSED();
    }
    const principal = principalFromKey(key as { tenantId: string; apiKeyId: string; scopes: string[]; isActive: boolean });
    if (!principal) throw REFUSED();
    return principal;
  },
  async recordUse(request, principal) {
    const mod = await ifActive(ROOT_TENANT_ID, 'api_key', () => import('@kuraykaraaslan-labs/api_key/server/api_key.service'));
    mod?.default.recordUseFromRequest(request, principal.apiKeyId);
  },
};

/** The workspace in the URL must be the key's. Anything else looks exactly like a bad key. */
export function assertSameTenant(urlTenantId: string | undefined, principal: McpPrincipal): void {
  if (urlTenantId !== undefined && urlTenantId !== principal.tenantId) throw REFUSED();
}
