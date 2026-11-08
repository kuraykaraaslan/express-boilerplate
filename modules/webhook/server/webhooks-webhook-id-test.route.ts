import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/webhooks/[webhookId]/test
 * Send a test delivery (ADMIN+). Executes synchronously and returns the delivery record. Refusals: 404, 409
 * `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN` (`details.reason`). Audited with the caller.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.test', scope: 'TENANT' });

    const delivery = await WebhookService.sendTest(tenantId, webhookId, auth?.user?.userId ?? null);
    return NextResponse.json({ delivery }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
