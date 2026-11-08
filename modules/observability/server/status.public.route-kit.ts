import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url'
import StatusPageService, { type StatusPageSpec } from './status.page.service'
import StatusAudienceService from './status.audience.service'
import StatusPublicService, { type PublicPage } from './status.public.service'
import { DEFAULT_PAGE_SLUG, isValidSlug } from './status.page.rules'

/**
 * The common spine of every anonymous page route (observability phase 15): rate limit, page lookup, audience gate, serialization,
 * cache headers. Keeping it in one place is what makes "every refusal looks alike" a property of the code rather than of five routes
 * each remembering to do it.
 *
 * The order is deliberate. The slug is validated by shape before any read; an unknown page and a refused visitor leave through the
 * same `AppError('Not found', 404)`; nothing about the page (its audience, whether it has a password) is knowable from an answer.
 */

export type PageCtx = { params: Promise<{ tenantId: string; slug: string }> }

export const notFound = () => new AppError('Not found', 404, ErrorCode.NOT_FOUND)

/** Edge-cacheable for a PUBLIC page; never shared for any other audience, whose answer depends on who asks. */
export function cacheHeaders(page: Pick<StatusPageSpec, 'audience'>): Record<string, string> {
  return page.audience === 'PUBLIC'
    ? { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=120' }
    : { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }
}

/** Rate limit, resolve, gate. Returns the page the request may see, or throws the common 404 (or 429). */
export async function openPage(request: NextRequest, tenantId: string, slug: string, scope: 'api' | 'auth' = 'api'): Promise<StatusPageSpec> {
  await Limiter.checkRateLimit(request, scope)
  if (!isValidSlug(slug)) throw notFound()
  const page = await StatusPageService.resolve(tenantId, slug)
  if (!page) throw notFound()
  await StatusAudienceService.assertAllowed(request, tenantId, page)
  return page
}

/** Exchange a password for the access cookie; every failure is the common 404 (or 429), see `StatusAudienceService.unlock`. */
export async function unlockPage(request: NextRequest, tenantId: string, slug: string, password: string) {
  return StatusAudienceService.unlock(request, tenantId, slug, password)
}

/** `openPage` plus the serialized page, in the language the visitor asked for. */
export async function openSerializedPage(request: NextRequest, tenantId: string, slug: string): Promise<{ page: StatusPageSpec; data: PublicPage }> {
  const page = await openPage(request, tenantId, slug)
  const lang = new URL(request.url).searchParams.get('lang')
  const data = await StatusPublicService.buildPublicPage(tenantId, page, { language: lang })
  return { page, data }
}

/** Absolute URL of the human page (where a feed entry or a badge click leads). */
export async function pageUrl(tenantId: string, page: Pick<StatusPageSpec, 'slug' | 'isDefault'>): Promise<string> {
  return absoluteTenantUrl(tenantId, page.slug === DEFAULT_PAGE_SLUG || page.isDefault ? '/status' : `/status/p/${page.slug}`)
}

export function textResponse(body: string, contentType: string, headers: Record<string, string> = {}): NextResponse {
  return new NextResponse(body, { status: 200, headers: { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', ...headers } })
}

/** Where the browser may open the live socket; null degrades to polling. The websocket module is optional for observability. */
export async function realtimeHint(): Promise<{ url: string; namespace: string } | null> {
  try {
    const { resolveWsPublicUrl } = await import('@kuraykaraaslan-labs/websocket/server/websocket.public-url')
    const resolved = resolveWsPublicUrl()
    return resolved.url ? { url: resolved.url, namespace: '/status' } : null
  } catch { return null }
}
