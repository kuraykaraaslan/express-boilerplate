import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusTranslationService, { ListTranslationsQuery, UpsertTranslationDTO } from './status.translation.service'

type Ctx = { params: Promise<{ tenantId: string }> }

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.read', scope: 'TENANT' })
    const q = ListTranslationsQuery.parse(Object.fromEntries(new URL(request.url).searchParams))
    return NextResponse.json({ items: await StatusTranslationService.list(tenantId, q) })
  } catch (e) { return normalizeError(e) }
}

/** Set (or, with both fields empty, clear) one translation. PUT because the row is addressed by what it translates, not by an id. */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.status.manage', scope: 'TENANT' })
    const dto = UpsertTranslationDTO.parse(await request.json())
    return NextResponse.json({ item: await StatusTranslationService.upsert(tenantId, dto) })
  } catch (e) { return normalizeError(e) }
}
