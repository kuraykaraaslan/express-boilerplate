import { NextRequest } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { dashboardContext } from './dashboard.route.helpers'
import { COMPUTE_FRAME_CSP, COMPUTE_FRAME_SHELL } from './compute-shell'

type Ctx = { params: Promise<{ tenantId: string }> }

export { COMPUTE_FRAME_CSP, COMPUTE_FRAME_SHELL, COMPUTE_RUNNER_SOURCE, COMPUTE_SHELL_SCRIPT, COMPUTE_LOAD_TIMEOUT_MS } from './compute-shell'

/**
 * GET …/dashboard/compute-frame: the shell a board view's compute iframe loads (`ui/compute-host.tsx`; the shell and
 * its policy, with every directive justified, are `compute-shell.ts`). It carries no tenant data, but it is guarded like
 * every dashboard route (the iframe's request comes from the app page and carries the session), exactly as the template
 * frame (`dashboard-frame.route.ts`). A display link's screen, which has no session, loads the same shell from
 * `dashboard-display-compute-frame.route.ts` (POSTURE §13).
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request)
    await dashboardContext({ request, tenantId, requiredPermission: 'dashboard.boards.read' })
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
