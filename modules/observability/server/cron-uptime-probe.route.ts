import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'
import { runProbeSweep } from './uptime.probe.job'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'

/**
 * POST /tenant/[tenantId]/api/cron/uptime-probe
 * Serverless twin of the minutely BullMQ probe sweep (uptime.probe.job.ts):
 * probes every ACTIVE monitor whose intervalSeconds has elapsed. Platform-wide
 * — call it on the root tenant, minutely. Bearer token = CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET

  if (!cronSecret) {
    Logger.warn('[Cron:uptime-probe] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:uptime-probe] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await cronRun(PLATFORM_CRON_JOBS.probe, () => runProbeSweep())
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:uptime-probe] Failed: ${message}`)
    // observability.06: the raw message is logged only.
    return NextResponse.json({ success: false, message: 'Cron run failed' }, { status: 500 })
  }
}
