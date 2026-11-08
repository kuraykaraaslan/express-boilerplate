import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'
import { runTimeSeriesRollupSweep } from './db.time-series.job'

/**
 * POST /tenant/[tenantId]/api/cron/time-series-rollup
 * Serverless twin of the per-minute time-series rollup pass (db.time-series.job.ts).
 * Platform-wide - call it on the root tenant, every minute. Bearer token = CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET

  if (!cronSecret) {
    Logger.warn('[Cron:time-series-rollup] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:time-series-rollup] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runTimeSeriesRollupSweep()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:time-series-rollup] Failed: ${message}`)
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
