import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'
import { cronRun, PLATFORM_CRON_JOBS } from './cron.heartbeat'
import { runReconcileSweep } from './observability.reconcile'

/**
 * POST /tenant/[tenantId]/api/cron/metering-reconcile[?day=YYYY-MM-DD]
 * Serverless twin of the daily metering reconciliation (observability.reconcile.job.ts). Platform-wide: call it on the root tenant once a day, after
 * 02:00 UTC. Bearer = CRON_SECRET. `day` re-runs one past day (idempotent: it overwrites that day's stored rows).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) {
    Logger.warn('[Cron:metering-reconcile] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:metering-reconcile] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }
  const day = new URL(request.url).searchParams.get('day')
  if (day !== null && !/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ success: false, message: 'day must be YYYY-MM-DD' }, { status: 400 })
  try {
    const result = await cronRun(PLATFORM_CRON_JOBS.reconcile, () => (day ? runReconcileSweep(new Date(), day) : runReconcileSweep()))
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:metering-reconcile] Failed: ${message}`)
    // observability.06: the raw message is logged only.
    return NextResponse.json({ success: false, message: 'Cron run failed' }, { status: 500 })
  }
}
