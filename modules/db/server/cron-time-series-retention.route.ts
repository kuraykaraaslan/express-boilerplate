import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'
import { runTimeSeriesRetentionSweep } from './db.time-series.job'

/**
 * POST /tenant/[tenantId]/api/cron/time-series-retention
 * Serverless twin of the hourly time-series retention pass (db.time-series.job.ts).
 * Platform-wide - call it on the root tenant, hourly. Bearer token = CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET

  if (!cronSecret) {
    Logger.warn('[Cron:time-series-retention] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:time-series-retention] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await runTimeSeriesRetentionSweep()
    return NextResponse.json({ success: true, ...result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:time-series-retention] Failed: ${message}`)
    return NextResponse.json({ success: false, message }, { status: 500 })
  }
}
