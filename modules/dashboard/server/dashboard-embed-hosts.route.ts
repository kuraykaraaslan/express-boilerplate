import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { dashboardContext } from './dashboard.route.helpers'
import { getEmbedHosts } from './embed-hosts'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/embed-hosts: the sites a `content.embed` card may frame in this tenant (decision 2026-10-17 #9).
 *
 * The cards need the list to decide what to frame, and a viewer may not read tenant settings (that endpoint is
 * admin-only), so the dashboard serves this one value to anyone who may read boards. It is not secret: every
 * allowed site is visible in the cards that frame it.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
    return NextResponse.json({ hosts: await getEmbedHosts(tenantId) })
  } catch (e) {
    return normalizeError(e)
  }
}
