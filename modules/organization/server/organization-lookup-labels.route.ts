import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import OrganizationLookupService from '@kuraykaraaslan-labs/organization/server/organization.lookup.service'
import { ResolveOrganizationLabelsDTO } from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

/**
 * Batch label resolution. POST because the id list is a body, not a query
 * string — a page resolving a 50-row viewport would otherwise blow past URL
 * length limits. It reads nothing it does not already return, so it stays on the
 * `organization.lookup.read` permission and answers 200, never 201.
 *
 * This is the endpoint `accounting` calls to label a journal line's cost center
 * without requiring `organization`: a 404 (module disabled) simply hides the
 * column.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.lookup.read', scope: 'TENANT' })
    const dto = ResolveOrganizationLabelsDTO.parse(await request.json())
    const labels = await OrganizationLookupService.resolveLabels(tenantId, dto.refs)
    return NextResponse.json({ labels })
  } catch (e) {
    return normalizeError(e)
  }
}
