import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import CheckDetailService from './uptime.check-detail.service'

type Ctx = { params: Promise<{ tenantId: string; monitorId: string; checkId: string }> }

const UUID = /^[0-9a-f-]{36}$/i

/**
 * GET /api/monitors/{id}/checks/{checkId}/screenshot — the JPEG a browser run took at the step that failed (D-OBS-8).
 *
 * Its own permission, `observability.screenshots.read` (ADMIN), NOT `monitors.read`: the page under test can show anything (a signed-in account, a customer's data), and
 * `monitors.read` is the MEMBER-floored permission. The session is the credential (no link to hand out), tenant and monitor are part of the lookup, and the answer is
 * private, uncached by shared caches, and cannot be sniffed into anything but an image.
 */
export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId, monitorId, checkId } = await params
    await Limiter.checkRateLimit(request, 'api')
    await authorizeRequest({ request, tenantId, requiredPermission: 'observability.screenshots.read', scope: 'TENANT' })
    if (!UUID.test(monitorId) || !UUID.test(checkId)) throw new AppError('Screenshot not found', 404, ErrorCode.NOT_FOUND)
    const shot = await CheckDetailService.screenshot(tenantId, monitorId, checkId)
    return new NextResponse(new Uint8Array(shot.bytes), {
      status: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(shot.bytes.length),
        ETag: `"${shot.sha256}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        // Whatever it is, it is an image: no script, no frame, no download name that could be abused.
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Disposition': 'inline; filename="screenshot.jpg"',
        'Cross-Origin-Resource-Policy': 'same-origin',
      },
    })
  } catch (e) { return normalizeError(e) }
}
