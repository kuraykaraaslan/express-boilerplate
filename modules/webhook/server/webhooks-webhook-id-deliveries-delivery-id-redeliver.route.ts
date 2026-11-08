import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/webhooks/[webhookId]/deliveries/[deliveryId]/redeliver
 * Re-queue a FAILED or DEAD_LETTERED delivery (ADMIN+). 200 `{ message }`. Refusals carry `details.reason`
 * (41-ui-fixes/12 1.5): 409 `DELIVERY_NOT_REDELIVERABLE` (+ `details.status`), 409 `TEST_DELIVERY_NOT_REDELIVERABLE`,
 * 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN`; 404 for an unknown endpoint or delivery.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string; deliveryId: string }> },
) {
  try {
    const { tenantId, webhookId, deliveryId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.deliveries.redeliver', scope: 'TENANT' });

    await WebhookService.redeliver(tenantId, webhookId, deliveryId, auth?.user?.userId ?? null);
    return NextResponse.json({ message: 'Webhook redelivery queued.' }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
