import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import Logger from '@kuraykaraaslan-labs/logger'
import { exchangeToken, OauthError } from './oauth/mcp_oauth.service'
import { oauthError, oauthJson, preflight, readForm } from './oauth/mcp_oauth.http'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST /tenant/[tenantId]/api/mcp/oauth/token: the token endpoint (RFC 6749 §3.2; docs/phases/57-mcp-server D57-8). The credential is
 * the request itself: an authorization code with its PKCE verifier, or a refresh token, for the URL's workspace and the named client.
 * Rate limited on the auth budget (fail closed). Every refusal is an RFC 6749 error with no token and no write but the code's removal
 * (a code is taken once, whatever follows) and, for a reused refresh token, the grant's revocation.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'auth')
    const form = await readForm(request)
    return oauthJson(await exchangeToken(tenantId, form))
  } catch (e) {
    if (e instanceof OauthError) return oauthError(e)
    const status = (e as { statusCode?: number })?.statusCode
    if (status === 429) return oauthJson({ error: 'temporarily_unavailable', error_description: 'Too many requests.' }, 429)
    Logger.error(`[mcp-oauth] token endpoint failed: ${e instanceof Error ? e.message : String(e)}`)
    return oauthJson({ error: 'server_error', error_description: 'The token endpoint failed.' }, 500)
  }
}

export const OPTIONS = preflight
