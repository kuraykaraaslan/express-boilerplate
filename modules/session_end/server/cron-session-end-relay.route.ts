import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth';
import { relayPass } from './session_end.relay';

/**
 * POST /tenant/[tenantId]/api/cron/session-end-relay
 *
 * The HTTP twin of the session-ending relay (`session_end.relay.ts`; docs/guides/cron/README.md): one pass over the due orders of every
 * tenant. Platform-wide: call it on the root tenant, every minute, when no process runs background jobs. Bearer token = CRON_SECRET.
 * Idempotent: rows are locked `SKIP LOCKED` and the readers act on an order id once.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET;

  if (!cronSecret) {
    Logger.warn('[Cron:session-end-relay] CRON_SECRET not configured — endpoint disabled');
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:session-end-relay] Unauthorized attempt');
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await relayPass();
    if (result.delivered || result.failed || result.dead) {
      Logger.info(`[Cron:session-end-relay] delivered=${result.delivered} failed=${result.failed} dead=${result.dead}`);
    }
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`[Cron:session-end-relay] Failed: ${message}`);
    return NextResponse.json({ success: false, message }, { status: 500 });
  }
}
