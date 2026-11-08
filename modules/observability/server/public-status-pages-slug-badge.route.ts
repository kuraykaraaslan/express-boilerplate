import { NextRequest } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { buildBadgeSvg } from './status.badge'
import { notFound, openSerializedPage, textResponse, type PageCtx } from './status.public.route-kit'

/**
 * The SVG status badge of a page or (`?componentId=`) one component. Badges are for PUBLIC pages only: an image embedded on another
 * site cannot carry a password cookie, so a badge of a restricted page would either leak or never work, and neither is offered. Any
 * other audience answers the common 404.
 */
export async function GET(request: NextRequest, { params }: PageCtx) {
  try {
    const { tenantId, slug } = await params
    const { page, data } = await openSerializedPage(request, tenantId, slug)
    if (page.audience !== 'PUBLIC') throw notFound()
    const componentId = new URL(request.url).searchParams.get('componentId')
    let label = data.page.name
    let status: string = data.overall
    if (componentId) {
      const c = data.components.find((x) => x.componentId === componentId)
      if (!c) throw notFound()
      label = c.name
      status = c.status
    }
    return textResponse(buildBadgeSvg({ label, status }), 'image/svg+xml; charset=utf-8', {
      'Cache-Control': 'public, max-age=60, s-maxage=60, stale-while-revalidate=300',
    })
  } catch (e) {
    return normalizeError(e)
  }
}
