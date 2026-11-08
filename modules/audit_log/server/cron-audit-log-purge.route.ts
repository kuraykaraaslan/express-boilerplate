import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuth } from '@kuraykaraaslan-labs/common/server/cron-auth';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';
import { runAuditPurgeSweep } from './audit_log.purge.sweep';

/**
 * POST /api/cron/audit-log-purge: the serverless twin of the BullMQ retention purge (`audit_log.purge.job`). Same body, no queue and no Redis: a deployment without
 * a BullMQ consumer points a scheduler here once a day. Idempotent (a run with nothing past its window deletes nothing). Platform-wide, guarded by CRON_SECRET.
 */
export async function POST(request: NextRequest) {
  try {
    assertCronAuth(request);
    return NextResponse.json(await runAuditPurgeSweep());
  } catch (e) {
    return normalizeError(e);
  }
}
