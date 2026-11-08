import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import SiteService from '@kuraykaraaslan-labs/organization/server/organization.site.service'
import { CreateSiteDTO, GetSitesQuery } from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.sites.read', scope: 'TENANT' })
    const query = readListQuery(new URL(request.url).searchParams, GetSitesQuery)
    const { data, total } = await SiteService.list(tenantId, query)
    return NextResponse.json({ data, total })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.sites.create', scope: 'TENANT' })
    const dto = CreateSiteDTO.parse(await request.json())
    const item = await SiteService.create(tenantId, dto, user.userId)
    return NextResponse.json({ item }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
