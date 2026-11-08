import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { listGrantsFor } from './mcp-grants.route'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET /tenant/[tenantId]/api/mcp/grants/all: every person's connected AI apps (docs/phases/57-mcp-server D57-13), for an admin holding
 * `mcp_server.settings.manage`. A person's session only, not an API key.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const auth = (await authorizeRequest({ request, tenantId, requiredPermission: 'mcp_server.settings.manage', scope: 'TENANT' })) as TenantAuthResult
    if (auth.apiKey) throw new AppError('Sign in to see connected apps', 403, ErrorCode.FORBIDDEN)
    return await listGrantsFor(request, tenantId, null)
  } catch (e) {
    return normalizeError(e)
  }
}
