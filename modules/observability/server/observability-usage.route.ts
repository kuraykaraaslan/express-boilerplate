import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { isRootTenant } from '@kuraykaraaslan-labs/common/server/tenant-constants'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'
import { listTenantUsage } from './observability.usage.service'
import { ListUsageQuery } from './usage.dto'

type Ctx = { params: Promise<{ tenantId: string }> }

/** GET /api/observability/usage — consumption per tenant against its plan, as `{ rows, data, total }`. ROOT tenant only: it reads across tenants. */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    if (!isRootTenant(tenantId)) return NextResponse.json({ error: 'not found' }, { status: 404 })
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.usage.read', scope: 'TENANT' })
    // The list contract: a whitelisted sort, search, the near-limit filter, pages (or the older offset); a bad sort is a 400.
    const q = readListQuery(request.nextUrl.searchParams, ListUsageQuery)
    const result = await listTenantUsage({
      sort: q.sort, limit: q.pageSize, offset: q.offset ?? q.page * q.pageSize, search: q.search, nearLimit: q.nearLimit,
    })
    return NextResponse.json({ ...result, data: result.rows }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return normalizeError(e) }
}
