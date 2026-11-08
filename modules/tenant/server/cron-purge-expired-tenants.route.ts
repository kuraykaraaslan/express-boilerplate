import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import TenantDeletionService from '@kuraykaraaslan-labs/tenant/server/tenant.deletion.service';
import { expireLegalHolds } from '@kuraykaraaslan-labs/tenant/server/tenant.legal-hold';
import Logger from '@kuraykaraaslan-labs/logger';
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth';

/**
 * POST /tenant/[tenantId]/api/cron/purge-expired-tenants
 * Hard-deletes tenants whose 30-day grace period has elapsed, then the files
 * purged tenants retained whose retention has ended. Protected by
 * Bearer token matching CRON_SECRET. The route accepts any `tenantId` in the
 * URL because the job is platform-wide — the path is just where serverless
 * crons can reach it; call it on the root tenant.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET;

  if (!cronSecret) {
    Logger.warn('[Cron:tenant-purge] CRON_SECRET not configured — endpoint disabled');
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:tenant-purge] Unauthorized attempt');
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Holds that ran out first, each reported to the fleet directory's mirror (decision F19); a failure here never stops the purge.
    const holdsExpired = await expireLegalHolds().catch((e: unknown) => { Logger.warn(`[Cron:tenant-purge] legal hold expiry failed: ${e instanceof Error ? e.message : String(e)}`); return 0; });
    const purged = await TenantDeletionService.purgeExpiredTenants();
    Logger.info(`[Cron:tenant-purge] purged=${purged}${holdsExpired ? ` legalHoldsExpired=${holdsExpired}` : ''}`);
    // The files purged tenants kept under retention, once it has ended (never throws).
    const files = await TenantDeletionService.sweepRetainedFiles();
    // Then the purged tenants whose data keys a failed destroy left standing (P7-TDEK crypto-shredding; never throws).
    const keys = await TenantDeletionService.sweepPurgedTenantKeys();
    return NextResponse.json({ success: true, purged, files, keys });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`[Cron:tenant-purge] Failed: ${message}`);
    // tenant.07 (fixed 2026-10-20): the internal error text stays in the log; the response is generic.
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
