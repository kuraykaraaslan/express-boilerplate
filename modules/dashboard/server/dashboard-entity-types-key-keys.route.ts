import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { selectEntityType } from './entity-types'
import { SubtypeSchema } from './board-aliases'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string; key: string }> }

/**
 * GET …/dashboard/entity-types/[key]/keys?search=&subtype= — the keys a key filter may test on this entity type (phase 36.7): its
 * fields, attribute keys and telemetry keys, as the module offers them. Behind the entity type's read permission; a key
 * type the caller may not read is answered by the module's own list only after the same ask the filter makes, so the list
 * never names a telemetry key to someone who may not read telemetry. `subtype` (49a, AD-06: a card's key picker) narrows the
 * list to the keys of entities of that subtype (a device profile); a malformed one is a 400.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, key } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT' })
    const type = await selectEntityType(tenantId, key)
    await authorizeRequest({ request, tenantId, requiredPermission: type.requiredPermission, scope: 'TENANT' })
    if (!type.keys) return NextResponse.json({ data: [], total: 0 })
    const search = (request.nextUrl.searchParams.get('search') ?? '').trim().slice(0, 120)
    const rawSubtype = request.nextUrl.searchParams.get('subtype')
    const subtype = rawSubtype === null || rawSubtype === '' ? null : SubtypeSchema.safeParse(rawSubtype)
    if (subtype && !subtype.success) throw new AppError('Invalid subtype', 400, ErrorCode.VALIDATION_ERROR)
    const all = await type.keys({ tenantId, locale: await appLocaleOf(request, tenantId) }, {
      ...(search ? { search } : {}), limit: 200, ...(subtype?.success ? { subtypes: [subtype.data] } : {}),
    })
    // Only the key types the caller may read through a filter.
    const allowed = new Set<string>()
    for (const kt of new Set(all.map((k) => k.type))) {
      const permission = type.keyPermissions?.[kt]
      if (!permission) continue
      try {
        await authorizeRequest({ request, tenantId, requiredPermission: permission, scope: 'TENANT' })
        allowed.add(kt)
      } catch { /* not readable: left out */ }
    }
    const data = all.filter((k) => allowed.has(k.type))
    return NextResponse.json({ data, total: data.length })
  } catch (e) {
    return normalizeError(e)
  }
}
