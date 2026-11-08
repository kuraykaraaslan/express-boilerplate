import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import SiteService from '@kuraykaraaslan-labs/organization/server/organization.site.service'
import { UpdateSiteDTO } from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'

type Ctx = { params: Promise<{ tenantId: string; siteId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, siteId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.sites.read', scope: 'TENANT' })
    const item = await SiteService.getById(tenantId, siteId)
    return NextResponse.json({ item })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, siteId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.sites.update', scope: 'TENANT' })
    const dto = UpdateSiteDTO.parse(await request.json())
    const item = await SiteService.update(tenantId, siteId, dto, user.userId)
    return NextResponse.json({ item })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, siteId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.sites.delete', scope: 'TENANT' })
    await SiteService.delete(tenantId, siteId, user.userId)
    return NextResponse.json({ success: true })
  } catch (e) {
    return normalizeError(e)
  }
}
