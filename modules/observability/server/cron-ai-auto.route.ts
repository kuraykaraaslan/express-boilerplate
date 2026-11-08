import { NextRequest, NextResponse } from 'next/server'
import { env } from '@kuraykaraaslan-labs/env'
import Logger from '@kuraykaraaslan-labs/logger'
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth'

/**
 * POST /tenant/[tenantId]/api/cron/ai-auto
 * Serverless twin of the delayed automatic investigation (ai/ai.auto.job.ts): runs, for every tenant that switched the automatic runs on,
 * the investigations that are due and have not run (the delay elapsed, or the incident resolved). Idempotent: at most one automatic run per
 * incident per phase, and the daily AI cap still applies. Platform-wide, call it every minute on the root tenant. Bearer token = CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET

  if (!cronSecret) {
    Logger.warn('[Cron:ai-auto] CRON_SECRET not configured — endpoint disabled')
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 })
  }

  const authHeader = request.headers.get('authorization')
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:ai-auto] Unauthorized attempt')
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { runAiAutoSweep } = await import('./ai/ai.auto.job')
    return NextResponse.json({ success: true, ...(await runAiAutoSweep()) })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    Logger.error(`[Cron:ai-auto] Failed: ${message}`)
    // observability.06: the raw message is logged only.
    return NextResponse.json({ success: false, message: 'Cron run failed' }, { status: 500 })
  }
}
