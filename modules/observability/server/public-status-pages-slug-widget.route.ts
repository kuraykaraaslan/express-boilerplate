import { NextRequest } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { buildWidgetHtml } from './status.static.html'
import { cacheHeaders, notFound, openSerializedPage, pageUrl, textResponse, type PageCtx } from './status.public.route-kit'

/**
 * The embeddable widget: a static HTML page with the banner and the component list, no script. It may be framed ONLY by the origins the
 * page's owner listed (`frame-ancestors`); with none listed nobody may frame it. PUBLIC pages only, like the badge.
 */
export async function GET(request: NextRequest, { params }: PageCtx) {
  try {
    const { tenantId, slug } = await params
    const { page, data } = await openSerializedPage(request, tenantId, slug)
    if (page.audience !== 'PUBLIC') throw notFound()
    const ancestors = page.embedOrigins.length > 0 ? page.embedOrigins.join(' ') : "'none'"
    const html = buildWidgetHtml(data, { statusUrl: await pageUrl(tenantId, page) })
    return textResponse(html, 'text/html; charset=utf-8', {
      ...cacheHeaders(page),
      'Content-Security-Policy': `frame-ancestors ${ancestors}`,
      ...(page.embedOrigins.length > 0 ? {} : { 'X-Frame-Options': 'DENY' }),
    })
  } catch (e) {
    return normalizeError(e)
  }
}
