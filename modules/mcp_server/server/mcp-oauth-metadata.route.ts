import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mcpUrls } from './oauth/mcp_oauth.urls'
import { SUPPORTED_SCOPES } from './oauth/mcp_oauth.service'
import { oauthJson, preflight } from './oauth/mcp_oauth.http'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET /tenant/[tenantId]/api/mcp/oauth/.well-known/oauth-authorization-server and …/openid-configuration: the authorization server
 * metadata (RFC 8414) of the workspace's MCP surface (docs/phases/57-mcp-server D57-8). Public by design (a client reads it before it
 * has any credential); it names endpoints and capabilities only. Authorization code + PKCE S256, public clients identified by a Client
 * ID Metadata Document, no dynamic registration.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const urls = await mcpUrls(tenantId)
    return oauthJson({
      issuer: urls.issuer,
      authorization_endpoint: urls.authorizationEndpoint,
      token_endpoint: urls.tokenEndpoint,
      revocation_endpoint: urls.revocationEndpoint,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      revocation_endpoint_auth_methods_supported: ['none'],
      scopes_supported: [...SUPPORTED_SCOPES],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    })
  } catch (e) {
    return normalizeError(e)
  }
}

export const OPTIONS = preflight
