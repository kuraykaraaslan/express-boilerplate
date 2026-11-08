import { NextRequest } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { absoluteTenantUrl } from '@kuraykaraaslan-labs/common/server/tenant-url'
import { buildAtomFeed, buildRssFeed } from './status.feed'
import { cacheHeaders, notFound, openSerializedPage, pageUrl, textResponse, type PageCtx } from './status.public.route-kit'

/**
 * RSS / Atom feed of a page (`?format=atom|rss`, default atom) or of one of its components (`?componentId=`). Public for a PUBLIC page,
 * the common 404 otherwise. It is built from the serialized page only, so a feed can carry nothing the page does not.
 */
export async function GET(request: NextRequest, { params }: PageCtx) {
  try {
    const { tenantId, slug } = await params
    const { page, data } = await openSerializedPage(request, tenantId, slug)
    const q = new URL(request.url).searchParams
    const format = q.get('format') === 'rss' ? 'rss' : 'atom'
    const componentId = q.get('componentId')
    // A component that is not on this page does not exist as far as this page can tell.
    if (componentId && !data.components.some((c) => c.componentId === componentId)) throw notFound()
    const selfUrl = await absoluteTenantUrl(tenantId, `/api/public/status/pages/${slug}/feed?format=${format}${componentId ? `&componentId=${encodeURIComponent(componentId)}` : ''}`)
    const args = { pageUrl: await pageUrl(tenantId, page), selfUrl, componentId }
    return format === 'rss'
      ? textResponse(buildRssFeed(data, args), 'application/rss+xml; charset=utf-8', cacheHeaders(page))
      : textResponse(buildAtomFeed(data, args), 'application/atom+xml; charset=utf-8', cacheHeaders(page))
  } catch (e) {
    return normalizeError(e)
  }
}
