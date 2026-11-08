import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import { TenantUsageService } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.service';
import { reconcileTenant, reportUnbilledBacklog } from '@kuraykaraaslan-labs/tenant_usage/server/tenant_usage.unbilled';
import Logger from '@kuraykaraaslan-labs/logger';
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth';
import { runWithTenant } from '@kuraykaraaslan-labs/db/server/db.context';
import { listActiveTenants } from '@kuraykaraaslan-labs/tenant/server/tenant.sweep';

/**
 * POST /tenant/[tenantId]/api/cron/usage-flush
 *
 * Iterates every active tenant and flushes their current-month Redis usage
 * counters (`apiCalls`, `aiTokens`, `storageBytes`, `emailSends`, `smsSends`)
 * into the `TenantUsage` table, after reconciling its unbilled units (D25). Idempotent — calling repeatedly within a
 * month upserts the running totals.
 *
 * Protected by Bearer token matching `CRON_SECRET`. Path tenantId is the
 * caller's tenant (typically root) and irrelevant to the work performed.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET;

  if (!cronSecret) {
    Logger.warn('[Cron:usage-flush] CRON_SECRET not configured — endpoint disabled');
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:usage-flush] Unauthorized attempt');
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const tenants = await listActiveTenants();

    const now = new Date();
    const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

    let flushed = 0;
    let unbilled = 0;
    for (const t of tenants) {
      try {
        // D25: units admitted while Redis could not count them reach the counters before the counters reach the table
        unbilled += await reconcileTenant(t.tenantId);
        await runWithTenant(t.tenantId, () => TenantUsageService.flushToDb(t.tenantId, month));
        flushed += 1;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'unknown';
        Logger.warn(`[Cron:usage-flush] flush failed for ${t.tenantId}: ${message}`);
      }
    }

    reportUnbilledBacklog(unbilled);
    Logger.info(`[Cron:usage-flush] flushed=${flushed}/${tenants.length} unbilled=${unbilled} month=${month}`);
    return NextResponse.json({ success: true, flushed, total: tenants.length, unbilled, month });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`[Cron:usage-flush] Failed: ${message}`);
    // The raw error stays in the log: it can carry infrastructure text (a connection string, a host).
    return NextResponse.json({ success: false, message: 'Usage flush failed' }, { status: 500 });
  }
}
