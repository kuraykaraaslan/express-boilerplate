import { NextRequest } from 'next/server'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { buildMaintenanceIcs } from './status.calendar'
import { cacheHeaders, openSerializedPage, pageUrl, textResponse, type PageCtx } from './status.public.route-kit'

/** The maintenance calendar (iCalendar) of a page: active and upcoming windows, from the serialized page only. */
export async function GET(request: NextRequest, { params }: PageCtx) {
  try {
    const { tenantId, slug } = await params
    const { page, data } = await openSerializedPage(request, tenantId, slug)
    const url = await pageUrl(tenantId, page)
    const ics = buildMaintenanceIcs(data, { host: new URL(url).host, pageUrl: url })
    return textResponse(ics, 'text/calendar; charset=utf-8', cacheHeaders(page))
  } catch (e) {
    return normalizeError(e)
  }
}
