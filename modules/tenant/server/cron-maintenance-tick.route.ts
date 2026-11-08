import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import Logger from '@kuraykaraaslan-labs/logger';
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth';
import MaintenanceService from '@kuraykaraaslan-labs/tenant/server/maintenance.service';

/**
 * POST /tenant/[tenantId]/api/cron/maintenance-tick
 * Serverless twin of the BullMQ maintenance scheduler (see
 * maintenance.scheduler.job.ts): starts due windows, auto-ends overdue ones,
 * sends advance notices. Platform-wide — call it on the root tenant, minutely.
 * Protected by a Bearer token matching CRON_SECRET.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET;

  if (!cronSecret) {
    Logger.warn('[Cron:tenant-maintenance] CRON_SECRET not configured — endpoint disabled');
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:tenant-maintenance] Unauthorized attempt');
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await MaintenanceService.tick();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`[Cron:tenant-maintenance] Failed: ${message}`);
    // tenant.07 (fixed 2026-10-20): the internal error text stays in the log; the response is generic.
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
