import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { grantedPermissions } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.granted.next'
import { getEnabledModuleIds } from '@kuraykaraaslan-labs/tenant_setting/server/module-activation.service.next'
import type { TenantAuthResult } from '@kuraykaraaslan-labs/tenant_session/server/tenant_session.types'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { toolRegistry } from './registry/mcp_server.registry'
import { getMcpPolicy } from './mcp_server.settings-policy'
import { buildMcpIndex } from './mcp_server.index'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET /tenant/[tenantId]/api/mcp: the MCP servers and tools of the workspace the caller may use (JSON, not MCP; docs/phases/57-mcp-server).
 * An API key or a session holding `mcp_server.connect`; a key sees what the key and its holder both hold.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const auth = (await authorizeRequest({ request, tenantId, requiredPermission: 'mcp_server.connect', scope: 'TENANT' })) as TenantAuthResult
    const [policy, registry, enabledModules] = await Promise.all([getMcpPolicy(tenantId), toolRegistry(), getEnabledModuleIds(tenantId)])
    const index = await buildMcpIndex({
      policy, catalog: registry.catalog, enabledModules,
      granted: (permissionIds) => grantedPermissions({ request, tenantId, permissionIds, session: auth }),
    })
    return NextResponse.json(index)
  } catch (e) {
    return normalizeError(e)
  }
}
