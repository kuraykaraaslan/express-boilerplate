import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.granted.next'
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { revokeGrantBy } from './oauth/mcp_oauth.service'

type Ctx = { params: Promise<{ tenantId: string; grantId: string }> }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * DELETE /tenant/[tenantId]/api/mcp/grants/[grantId]: disconnect an AI app for good (revokes the grant; its tokens stop at once). A
 * person revokes their own; an admin (`mcp_server.settings.manage`) anyone's. Another person's grant is "not found" to a person.
 */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, grantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const auth = (await authorizeRequest({ request, tenantId, requiredPermission: 'mcp_server.connect', scope: 'TENANT' })) as TenantAuthResult
    if (auth.apiKey) throw new AppError('Sign in to disconnect apps', 403, ErrorCode.FORBIDDEN)
    if (!UUID.test(grantId)) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    const admin = (await grantedPermissions({ request, tenantId, permissionIds: ['mcp_server.settings.manage'], session: auth })).has('mcp_server.settings.manage')
    if (!(await revokeGrantBy(tenantId, grantId, { userId: auth.user.userId, admin }))) throw new AppError('Not found', 404, ErrorCode.NOT_FOUND)
    return NextResponse.json({ revoked: true })
  } catch (e) {
    return normalizeError(e)
  }
}
