import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { FRAME_CSP, FRAME_SHELL } from './dashboard-frame.route'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/display/frame — the template-widget shell for a display link's screen (owner decision 2026-10-17
 * #10). The same static shell and the same policy as `…/dashboard/frame`, which a screen cannot load: that one needs
 * a session. It carries no token and no data (the template and its data are posted in by the host page), so the
 * gate is the GUEST `dashboard.display.view` permission, the switch that turns every screen of a tenant off.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.display.view', scope: 'GUEST' })
    return new Response(FRAME_SHELL, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': FRAME_CSP,
      },
    })
  } catch (e) {
    return normalizeError(e)
  }
}
