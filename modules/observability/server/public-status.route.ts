import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import StatusPublicService from './status.public.service'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * The public status page's data: allowlist-serialized in
 * `StatusPublicService` (no monitor name/target/header can appear — verify
 * with view-source). 404 when the tenant has not enabled the page, byte-equal
 * to an unknown tenant.
 *
 * Cached aggressively at the edge: a status page must answer precisely when
 * the origin is having its worst day, and 30s staleness is an honest price.
 * The live socket (or the client's polling) rides on top of this.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const status = await StatusPublicService.buildPublicStatus(tenantId)

    // Where the browser may open the live socket; null degrades to polling.
    // Dynamic import: the websocket module is optional for observability.
    let realtime: { url: string; namespace: string } | null = null
    try {
      const { resolveWsPublicUrl } = await import('@kuraykaraaslan-labs/websocket/server/websocket.public-url')
      const resolved = resolveWsPublicUrl()
      if (resolved.url) realtime = { url: resolved.url, namespace: '/status' }
    } catch { /* gateway not installed — polling only */ }

    return NextResponse.json({ ...status, realtime }, {
      headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' },
    })
  } catch (e) {
    return normalizeError(e)
  }
}
