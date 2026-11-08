import { NextRequest, NextResponse } from 'next/server'
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next'
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error'
import MonitorService from './uptime.monitor.service'
import type { HeartbeatSignal } from './uptime.heartbeat'

type Ctx = { params: Promise<{ tenantId: string; token: string }> }

/**
 * The public heartbeat endpoint. No session: the token IS the credential. Anything that does not match answers the same 404 as an
 * unknown tenant would, the response says nothing about the monitor, and the rate limit applies per caller address.
 * Accepts GET and POST because a cron line is usually `curl <url>`.
 */
export function heartbeatHandlers(signal: HeartbeatSignal) {
  const handle = async (request: NextRequest, { params }: Ctx) => {
    try {
      const { tenantId, token } = await params
      await Limiter.checkRateLimit(request, 'api')
      const { status } = await MonitorService.recordHeartbeat(tenantId, token, signal)
      return NextResponse.json({ status }, { headers: { 'Cache-Control': 'no-store' } })
    } catch (e) { return normalizeError(e) }
  }
  return { GET: handle, POST: handle }
}
