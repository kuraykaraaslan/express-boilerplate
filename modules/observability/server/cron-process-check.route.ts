import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'
import { runProcessChecks } from './process.checks'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'

/**
 * POST /tenant/[tenantId]/api/cron/process-check
 * Serverless twin of the expected-process check (process.registry.job.ts).
 * Platform-wide — call it on the root tenant, every minute. Bearer = CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET

  if (!cronSecret) {
    Logger.warn('[Cron:process-check] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:process-check] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await cronRun(PLATFORM_CRON_JOBS.processCheck, () => runProcessChecks())
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:process-check] Failed: ${message}`)
    // observability.06: the raw message is logged only.
    return NextResponse.json({ success: false, message: 'Cron run failed' }, { status: 500 })
  }
}
