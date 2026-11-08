import { NextRequest, NextResponse } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { cacheHeaders, openSerializedPage, realtimeHint, type PageCtx } from './status.public.route-kit'

/**
 * One status page's data, allowlist-serialized (observability phase 15). This is also the page's JSON API: it is public for a PUBLIC
 * page and answers the common 404 to anyone the audience refuses, exactly like a page that does not exist. `?lang=` picks one of the
 * languages the page offers. A PUBLIC page is edge-cacheable; every other audience is `private, no-store`.
 */
export async function GET(request: NextRequest, { params }: PageCtx) {
  try {
    const { tenantId, slug } = await params
    const { page, data } = await openSerializedPage(request, tenantId, slug)
    return NextResponse.json({ ...data, realtime: page.audience === 'PUBLIC' ? await realtimeHint() : null }, { headers: cacheHeaders(page) })
  } catch (e) {
    return normalizeError(e)
  }
}
