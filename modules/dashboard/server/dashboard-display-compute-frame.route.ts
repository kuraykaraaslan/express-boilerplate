import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { COMPUTE_FRAME_CSP, COMPUTE_FRAME_SHELL } from './compute-shell'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * GET …/dashboard/display/compute-frame — the compute shell for a display link's screen (phase 35.5; the display
 * route family of owner decision 2026-10-17 #10). The same static shell and the same policy as
 * `…/dashboard/compute-frame`, which a screen cannot load: that one needs a session. It carries no token and no data
 * (the scripts and their inputs are posted in by the host page, which itself got them through the display board
 * read), so the gate is the GUEST `dashboard.display.view` permission, the switch that turns every screen of a
 * tenant off, exactly as `dashboard-display-frame.route.ts` is gated.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await authorizeRequest({ request, tenantId, requiredPermission: 'dashboard.display.view', scope: 'GUEST' })
    return new Response(COMPUTE_FRAME_SHELL, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'content-security-policy': COMPUTE_FRAME_CSP,
      },
    })
  } catch (e) {
    return normalizeError(e)
  }
}
