import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/webhooks/metrics?webhookId=&days=7
 * Aggregate delivery metrics for the tenant (or one webhook) over a window (ADMIN+).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.metrics.read', scope: 'TENANT' });

    const { searchParams } = new URL(request.url);
    const webhookId = searchParams.get('webhookId') || undefined;
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '7', 10) || 7, 1), 365);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const metrics = await WebhookService.getMetrics(tenantId, { webhookId, since });
    return NextResponse.json({ metrics, days }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
