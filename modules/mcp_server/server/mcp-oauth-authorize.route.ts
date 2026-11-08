import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { checkAuthorize, decideAuthorize, paramsFrom } from './oauth/mcp_oauth.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/** The consent screen is a person's: never an API key's (a key cannot mint itself a grant) and never an MCP token's (it is refused here). */
async function person(request: NextRequest, tenantId: string): Promise<TenantAuthResult> {
  const auth = (await authorizeRequest({ request, tenantId, requiredPermission: 'mcp_server.connect', scope: 'TENANT' })) as TenantAuthResult
  if (auth.apiKey) throw new AppError('Sign in to connect an AI app', 403, ErrorCode.FORBIDDEN)
  return auth
}

/**
 * GET /tenant/[tenantId]/api/mcp/oauth/authorize?<the client's authorization request>: what the consent screen shows (the client's name
 * and host, the scope, the resource), or the error to show or redirect to (docs/phases/57-mcp-server D57-8). The signed-in person must
 * hold `mcp_server.connect`.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await person(request, tenantId)
    return NextResponse.json(await checkAuthorize(tenantId, paramsFrom(new URL(request.url).searchParams)))
  } catch (e) {
    return normalizeError(e)
  }
}

const DecisionBody = z.object({
  approve: z.boolean(),
  request: z.record(z.string(), z.string().max(1024)).refine((r) => Object.keys(r).length <= 12, 'Too many parameters'),
}).strict()

/**
 * POST /tenant/[tenantId]/api/mcp/oauth/authorize: the person's decision ({ approve, request }), re-validated from scratch; answers
 * { redirectTo } (the client's redirect URI with a one-time code, or with access_denied) or { error, description } when the request
 * cannot be redirected. CSRF applies (a person's session).
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const auth = await person(request, tenantId)
    const body = DecisionBody.parse(await request.json())
    const signedInAt = auth.userSession?.createdAt ? new Date(auth.userSession.createdAt as unknown as string) : null
    return NextResponse.json(await decideAuthorize(tenantId, auth.user.userId, paramsFrom(body.request), body.approve, undefined, { signedInAt }))
  } catch (e) {
    return normalizeError(e)
  }
}
