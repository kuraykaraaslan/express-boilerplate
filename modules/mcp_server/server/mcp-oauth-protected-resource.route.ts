import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mcpUrls, servedResource } from './oauth/mcp_oauth.urls'
import { SUPPORTED_SCOPES } from './oauth/mcp_oauth.service'
import { oauthJson, preflight } from './oauth/mcp_oauth.http'

type Ctx = { params: Promise<{ tenantId: string; moduleId: string }> }

/**
 * GET /tenant/[tenantId]/api/mcp/oauth/protected-resource/[moduleId]: the protected-resource metadata (RFC 9728) of one MCP server,
 * the URL a 401 of that server names in `WWW-Authenticate` (docs/phases/57-mcp-server D57-8). Public by design; it names the server's
 * canonical URI and its authorization server only (whether the server has tools for the caller is the server's own answer).
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, moduleId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const urls = await mcpUrls(tenantId)
    if (!servedResource(urls, urls.serverResource(moduleId))) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    return oauthJson({
      resource: urls.serverResource(moduleId),
      authorization_servers: [urls.issuer],
      scopes_supported: [...SUPPORTED_SCOPES],
      bearer_methods_supported: ['header'],
      resource_name: `MCP: ${moduleId}`,
    })
  } catch (e) {
    return normalizeError(e)
  }
}

export const OPTIONS = preflight
