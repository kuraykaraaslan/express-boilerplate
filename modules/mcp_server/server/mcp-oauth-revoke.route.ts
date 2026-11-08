import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import Logger from '@kuraykaraaslan-labs/logger'
import { OauthError, revokeToken } from './oauth/mcp_oauth.service'
import { oauthError, oauthJson, preflight, readForm } from './oauth/mcp_oauth.http'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST /tenant/[tenantId]/api/mcp/oauth/revoke: token revocation (RFC 7009; docs/phases/57-mcp-server D57-8). The token is the
 * credential: a refresh token revokes its grant, an access token is dropped, for the named client only. Always 200 (an unknown token is
 * no information), except a malformed request.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'auth')
    const form = await readForm(request)
    await revokeToken(tenantId, form)
    return oauthJson({})
  } catch (e) {
    if (e instanceof OauthError) return oauthError(e)
    const status = (e as { statusCode?: number })?.statusCode
    if (status === 429) return oauthJson({ error: 'temporarily_unavailable', error_description: 'Too many requests.' }, 429)
    Logger.error(`[mcp-oauth] revocation failed: ${e instanceof Error ? e.message : String(e)}`)
    return oauthJson({ error: 'server_error', error_description: 'The revocation endpoint failed.' }, 500)
  }
}

export const OPTIONS = preflight
