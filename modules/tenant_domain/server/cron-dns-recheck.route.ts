import { NextRequest, NextResponse } from 'next/server';
import { env } from '@kuraykaraaslan-labs/env';
import DNSVerificationService from '@kuraykaraaslan-labs/tenant_domain/server/dns_verification.service';
import { reconcileAllTenantDomains } from '@kuraykaraaslan-labs/tenant_domain/server/tenant_domain.reconcile';
import Logger from '@kuraykaraaslan-labs/logger';
import { constantTimeEqual } from '@kuraykaraaslan-labs/common/server/cron-auth';

/**
 * POST /tenant/[tenantId]/api/cron/dns-recheck
 * Runs the domain reconcile for every active tenant (free subdomain kept,
 * custom domains held to the plan), then re-resolves every ACTIVE custom
 * domain and flips broken ones to `DNS_FAILED`, like the self-hosted job
 * (tenant_domain.job). Protected by Bearer token matching CRON_SECRET. The route
 * accepts any `tenantId` in the URL because the job is platform-wide — the
 * path is just where serverless crons can reach it; call it on the root tenant.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const cronSecret = env.CRON_SECRET;

  if (!cronSecret) {
    Logger.warn('[Cron:dns-recheck] CRON_SECRET not configured — endpoint disabled');
    return NextResponse.json({ success: false, message: 'Cron endpoint not configured' }, { status: 503 });
  }

  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token || !constantTimeEqual(token, cronSecret)) {
    Logger.warn('[Cron:dns-recheck] Unauthorized attempt');
    return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
  }

  try {
    const reconciled = await reconcileAllTenantDomains();
    const { checked, downgraded } = await DNSVerificationService.recheckActiveDomains();
    Logger.info(`[Cron:dns-recheck] checked=${checked} downgraded=${downgraded} suspended=${reconciled.suspended} reactivated=${reconciled.reactivated} reservedSuspended=${reconciled.reservedSuspended}`);
    return NextResponse.json({ success: true, checked, downgraded, reconciled });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    Logger.error(`[Cron:dns-recheck] Failed: ${message}`);
    // tenant_domain.08: the raw message stays in the log; the caller gets a fixed answer.
    return NextResponse.json({ success: false, message: 'Sweep failed' }, { status: 500 });
  }
}
