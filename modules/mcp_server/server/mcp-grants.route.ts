import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { oauthStore } from './oauth/mcp_oauth.store'
import { safeGrant } from './oauth/mcp_oauth.service'
import { ListGrantsQuery } from './mcp_server.grants.dto'

type Ctx = { params: Promise<{ tenantId: string }> }

/** The list, for one person (`userId`) or the workspace (null). */
export async function listGrantsFor(request: NextRequest, tenantId: string, userId: string | null) {
  const q = readListQuery(new URL(request.url).searchParams, ListGrantsQuery)
  const sort = q.sort?.[0] ?? { field: 'createdAt', dir: 'desc' }
  const { data, total } = await oauthStore.listGrants(tenantId, {
    ...(userId ? { userId } : {}), page: q.page, pageSize: q.pageSize, sort: sort.field, dir: sort.dir,
    ...(q.search ? { search: q.search } : {}), ...(q.status?.length ? { status: q.status } : {}),
  })
  return NextResponse.json({ data: data.map(safeGrant), total })
}

/**
 * GET /tenant/[tenantId]/api/mcp/grants: the AI apps the signed-in person connected through OAuth (Connected apps; docs/phases/57-mcp-server
 * D57-13). `mcp_server.connect`; a person's session only, not an API key. Every person's: GET /api/mcp/grants/all.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const auth = (await authorizeRequest({ request, tenantId, requiredPermission: 'mcp_server.connect', scope: 'TENANT' })) as TenantAuthResult
    if (auth.apiKey) throw new AppError('Sign in to see connected apps', 403, ErrorCode.FORBIDDEN)
    return await listGrantsFor(request, tenantId, auth.user.userId)
  } catch (e) {
    return normalizeError(e)
  }
}
