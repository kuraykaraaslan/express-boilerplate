import { NextRequest, NextResponse } from 'next/server';
import Logger from '@kuraykaraaslan-labs/logger';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { assertCronAuth } from '@kuraykaraaslan-labs/common/server/cron-auth';

/**
 * HTTP twin of the `webhook-pending-sweep` job (D252), for deployments with no worker (`ENABLE_BACKGROUND_JOBS=false`). Re-enqueues the
 * PENDING webhook deliveries whose BullMQ job was lost (webhook.pending-sweep.ts). Takes no input: the request body and query are not
 * read. Safe next to a live worker: the sweep holds a lock and a re-enqueued job's id is its delivery id.
 *
 * Auth is the shared `CRON_SECRET` bearer token; with no secret configured this refuses with 503 rather than running unauthenticated.
 */
export async function POST(request: NextRequest) {
  try {
    assertCronAuth(request);
    const { sweepPendingDeliveries } = await import('./webhook.pending-sweep');
    const out = await sweepPendingDeliveries();
    Logger.info(`[cron:webhook-pending-sweep] candidates=${out.candidates} requeued=${out.requeued} live=${out.live} deadLettered=${out.deadLettered}${out.skipped ? ` skipped=${out.skipped}` : ''}`);
    return NextResponse.json(out);
  } catch (e) {
    return normalizeError(e);
  }
}
