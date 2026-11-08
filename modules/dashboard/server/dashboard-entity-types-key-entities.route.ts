import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { MAX_ENTITY_LIST } from './board-aliases'
import { selectEntityType } from './entity-types'
import { appLocaleOf } from './board-template.locale'

type Ctx = { params: Promise<{ tenantId: string; key: string }> }

const ID = /^[A-Za-z0-9_-]{1,64}$/

/**
 * GET …/dashboard/entity-types/[key]/entities?search=&ids= — the alias editor's entity picker (phase 36): a search
 * (`{ data, total }`, 50 at a time, by name) or, with `ids`, the labels of chosen entities (at most 100). Behind the
 * entity type's own read permission; an id of another tenant is answered as unknown.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, key } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.query.execute', scope: 'TENANT' })
    const type = await selectEntityType(tenantId, key)
    await authorizeRequest({ request, tenantId, requiredPermission: type.requiredPermission, scope: 'TENANT' })
    const ctx = { tenantId, locale: await appLocaleOf(request, tenantId) }
    const rawIds = request.nextUrl.searchParams.get('ids')
    if (rawIds !== null) {
      const ids = [...new Set(rawIds.split(',').map((s) => s.trim()).filter(Boolean))]
      if (ids.length > MAX_ENTITY_LIST || ids.some((id) => !ID.test(id))) throw new AppError('Invalid ids', 400, ErrorCode.VALIDATION_ERROR)
      const data = ids.length ? (await type.byIds(ctx, ids)).map((e) => ({ ...e, type: key })) : []
      return NextResponse.json({ data, total: data.length })
    }
    const search = (request.nextUrl.searchParams.get('search') ?? '').trim().slice(0, 120)
    const r = await type.find(ctx, { ...(search ? { search } : {}), limit: 50 })
    return NextResponse.json({ data: r.rows.map((e) => ({ ...e, type: key })), total: r.total })
  } catch (e) {
    return normalizeError(e)
  }
}
