import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next'
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import { mapTelemetryError, readJsonBody, requireBackend } from './telemetry.http'
import { TAIL_NAMESPACE_PATH, type TailTicketPayload } from './telemetry.tail.realtime'

type Ctx = { params: Promise<{ tenantId: string }> }

/**
 * POST /api/telemetry/tail-ticket: authorise a live log tail and mint ONE single-use `/telemetry-tail` handshake ticket.
 *
 * The tenant is the URL workspace after the session guard for `observability.telemetry.read`; the ticket's payload is that tenant and the
 * user, and the gateway takes the tenant of the tail from it and from nothing a client sends. The body must be empty (`{}`): there is
 * nothing to choose here, and an unknown key is a 400. The filter is sent later, over the socket, and validated there with the REST
 * log query's schema.
 *
 * `wsUrl` is `null` when the deployment has no gateway (or the websocket module is not installed): no ticket is minted and the logs page
 * keeps its 5 second refresh. 503 when telemetry storage is off, like every other telemetry route.
 */
export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const { tenantId } = await params
    await Limiter.checkRateLimit(request, 'api')
    const { user, userSession } = await authorizeRequest({ request, tenantId, requiredPermission: 'observability.telemetry.read', scope: 'TENANT' })
    const body = await readJsonBody(request, 1024)
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length > 0) {
      throw new AppError('This request takes no body', 400, ErrorCode.VALIDATION_ERROR)
    }
    const backend = requireBackend()
    if (!backend.capabilities.signals.logs) throw new AppError('The configured backend does not store logs', 501, ErrorCode.FEATURE_NOT_AVAILABLE)

    // The websocket module is optional: its absence is "no live tail", never an error. (A failure to MINT is an error and surfaces.)
    let wsUrl: string | null = null
    let binding: typeof import('@kuraykaraaslan-labs/websocket/server/websocket.session-binding') | null = null
    try {
      const { resolveWsPublicUrl } = await import('@kuraykaraaslan-labs/websocket/server/websocket.public-url')
      binding = await import('@kuraykaraaslan-labs/websocket/server/websocket.session-binding')
      wsUrl = resolveWsPublicUrl().url ?? null
    } catch { wsUrl = null }
    if (!wsUrl || !binding) return NextResponse.json({ ticket: null, wsUrl: null, path: TAIL_NAMESPACE_PATH })

    // Only a full user session gets a ticket (websocket 04 §4.8); outside the try above, so a refusal is a refusal, not "no live tail".
    const subject = binding.wsTicketSubject({ user, userSession, origin: request.headers.get('origin') })
    const { tailTicketService } = await import('./telemetry.tail.ticket')
    const payload: TailTicketPayload = { tenantId, ...subject, iat: Date.now() }
    const { ticket, expiresIn } = await tailTicketService.mint(payload)
    return NextResponse.json({ ticket, expiresIn, wsUrl, path: TAIL_NAMESPACE_PATH }, { status: 201 })
  } catch (e) { return normalizeError(mapTelemetryError(e)) }
}
