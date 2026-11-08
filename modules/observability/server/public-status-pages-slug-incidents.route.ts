import { NextRequest, NextResponse } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusPublicService from './status.public.service'
import { cacheHeaders, openPage, type PageCtx } from './status.public.route-kit'

/**
 * The full incident archive of a page, newest first, paged by `before` (an ISO time) and `limit`. Same gate and same projection as the
 * page itself; an unreadable `before` is ignored rather than explained.
 */
export async function GET(request: NextRequest, { params }: PageCtx) {
  try {
    const { tenantId, slug } = await params
    const page = await openPage(request, tenantId, slug)
    const q = new URL(request.url).searchParams
    const beforeRaw = q.get('before')
    const before = beforeRaw && !Number.isNaN(Date.parse(beforeRaw)) ? new Date(beforeRaw) : null
    const limit = Number.parseInt(q.get('limit') ?? '', 10)
    const archive = await StatusPublicService.buildPublicArchive(tenantId, page, {
      language: q.get('lang'), before, limit: Number.isFinite(limit) ? limit : undefined,
    })
    return NextResponse.json(archive, { headers: cacheHeaders(page) })
  } catch (e) {
    return normalizeError(e)
  }
}
