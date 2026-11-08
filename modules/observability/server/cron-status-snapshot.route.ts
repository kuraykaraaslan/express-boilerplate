import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'
import { runSnapshotSweep } from './status.snapshot.job'

/**
 * POST /tenant/[tenantId]/api/cron/status-snapshot
 * Serverless twin of the five-minute status snapshot heartbeat (status.snapshot.job.ts): refreshes the static copy of every public status
 * page and retracts the ones that are no longer public. Platform-wide, call it on the root tenant every five minutes. Bearer token = CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET
  if (!cronSecret) {
    Logger.warn('[Cron:status-snapshot] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }
  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:status-snapshot] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }
  try {
    return NextResponse.json({ success: true, ...(await runSnapshotSweep()) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:status-snapshot] Failed: ${message}`)
    // observability.06: the raw message is logged only.
    return NextResponse.json({ success: false, message: 'Cron run failed' }, { status: 500 })
  }
}
