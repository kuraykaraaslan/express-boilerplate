import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import LegalEntityService from '@kuraykaraaslan-labs/organization/server/organization.legal-entity.service'
import {
  CreateLegalEntityDTO,
  GetLegalEntitiesQuery,
} from '@kuraykaraaslan-labs/organization/server/organization.dto'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { readListQuery } from '@kuraykaraaslan-labs/common/server/common.list-query'

export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'organization.legal_entities.read', scope: 'TENANT' })
    const query = readListQuery(new URL(request.url).searchParams, GetLegalEntitiesQuery)
    const { data, total } = await LegalEntityService.list(tenantId, query)
    return NextResponse.json({ data, total })
  } catch (e) {
    return normalizeError(e)
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'organization.legal_entities.create', scope: 'TENANT' })
    const dto = CreateLegalEntityDTO.parse(await request.json())
    // organization.01: creating the default entity projects onto the tenant settings too.
    if (dto.isDefault === true) {
      await authorizeRequest({ request, tenantId, requiredPermission: 'tenant_setting.config.update', scope: 'TENANT' })
    }
    const item = await LegalEntityService.create(tenantId, dto, user.userId)
    return NextResponse.json({ item }, { status: 201 })
  } catch (e) {
    return normalizeError(e)
  }
}
