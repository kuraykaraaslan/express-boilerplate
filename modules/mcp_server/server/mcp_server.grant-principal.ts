/**
 * mcp_server's half of the MCP grant lane of auth_abac's tenant guard (docs/phases/57-mcp-server D57-8): which grant a presented
 * `Bearer mcp_at_…` token is, for the URL's workspace. auth_abac loads this file with `ifActive` (it never imports mcp_server) and does
 * the person's half itself: membership and user ACTIVE, the role floor, the PDP, as for an API key's holder.
 */
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';
import { MCP_GRANT_BEARER } from '@kuraykaraaslan-labs/common/server/lane';
import { verifyAccessToken, type GrantPrincipal } from './oauth/mcp_oauth.service';

export type { GrantPrincipal };

const REFUSED = () => new AppError('Invalid or expired access token', 401, ErrorCode.UNAUTHORIZED);

export async function resolveGrantPrincipal(
  request: { headers: { get(name: string): string | null } }, tenantId: string, ip: string | null,
): Promise<GrantPrincipal> {
  const authorization = (request.headers.get('authorization') ?? '').trim();
  if (!MCP_GRANT_BEARER.test(authorization)) throw REFUSED();
  let principal: GrantPrincipal | null;
  try {
    principal = await verifyAccessToken(tenantId, authorization.replace(/^Bearer\s+/i, ''), undefined, { ip });
  } catch {
    // F23: a check that could not run has not run.
    throw REFUSED();
  }
  if (!principal) throw REFUSED();
  return principal;
}
