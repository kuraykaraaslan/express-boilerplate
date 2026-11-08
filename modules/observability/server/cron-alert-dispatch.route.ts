import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'
import { runAlertSweep } from './alert.dispatch.job'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'

/**
 * POST /tenant/[tenantId]/api/cron/alert-dispatch
 * Serverless twin of the minutely BullMQ alert dispatcher (alert.dispatch.job.ts):
 * announces every alert group whose wait is over and releases alerts a silence or a recovered parent was holding back. Platform-wide
 * — call it on the root tenant, minutely. Bearer token = CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET

  if (!cronSecret) {
    Logger.warn('[Cron:alert-dispatch] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:alert-dispatch] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await cronRun(PLATFORM_CRON_JOBS.alertDispatch, () => runAlertSweep())
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:alert-dispatch] Failed: ${message}`)
    // observability.06: the raw message is logged only.
    return NextResponse.json({ success: false, message: 'Cron run failed' }, { status: 500 })
  }
}
