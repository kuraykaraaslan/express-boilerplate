import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/webhooks/report?webhookId=&days=30
 *
 * Reporting suite over `webhook_deliveries`: daily delivery time-series
 * (success vs failure), failure analysis (top error patterns + response-code
 * histogram), tenant-wide auto-disabled endpoints, and — when `webhookId` is
 * supplied — that endpoint's reliability snapshot (ADMIN+).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.reports.read', scope: 'TENANT' });

    const { searchParams } = new URL(request.url);
    const webhookId = searchParams.get('webhookId') || undefined;
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '30', 10) || 30, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const report = await WebhookService.getReport(tenantId, { webhookId, since });
    return NextResponse.json({ report, days }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
