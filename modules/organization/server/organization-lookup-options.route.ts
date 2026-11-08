import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import OrganizationLookupService from '@kuraykaraaslan-labs/organization/server/organization.lookup.service'
import { GetOrganizationOptionsQuery } from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

/**
 * Picker feed for one catalog. Guarded by `organization.lookup.read` (minRole
 * USER), not the per-catalog ADMIN read permission: an ESS or manager surface
 * has to be able to render a site picker without being able to administer the
 * organization.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.lookup.read', scope: 'TENANT' })
    const sp = new URL(request.url).searchParams
    const query = GetOrganizationOptionsQuery.parse({ kind: sp.get('kind') ?? undefined })
    const data = await OrganizationLookupService.options(tenantId, query.kind)
    return NextResponse.json({ data, total: data.length })
  } catch (e) {
    return normalizeError(e)
  }
}
