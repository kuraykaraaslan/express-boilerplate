import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { selectEntityType } from './entity-types'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string; key: string }> }

/** GET …/dashboard/entity-types/[key]/subtypes?search= — the subtypes an entity-subtype alias offers (phase 36). */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, key } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT' })
    const type = await selectEntityType(tenantId, key)
    await authorizeRequest({ request, tenantId, requiredPermission: type.requiredPermission, scope: 'TENANT' })
    const search = (request.nextUrl.searchParams.get('search') ?? '').slice(0, 120)
    const data = type.subtypes ? await type.subtypes({ tenantId, locale: await appLocaleOf(request, tenantId) }, { search, limit: 100 }) : []
    return NextResponse.json({ data, total: data.length })
  } catch (e) {
    return normalizeError(e)
  }
}
