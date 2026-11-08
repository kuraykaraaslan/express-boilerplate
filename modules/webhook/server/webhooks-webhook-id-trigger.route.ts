import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { TriggerWebhookDTO } from '@kuraykaraaslan-labs/webhook/server/webhook.dto';
import { assertSubscribableEvents } from '@kuraykaraaslan-labs/webhook/server/webhook.crud.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/webhooks/[webhookId]/trigger
 * Manually trigger a real catalog event with a sample payload against one endpoint
 * (ADMIN+). Enqueues an async delivery — distinct from /test which sends event:'test'. 200 `{ message, deliveryId }`.
 * The delivery is marked manual (`manual: true` in the body, `X-Webhook-Manual: true`). Refusals: 422
 * `EVENT_FILTERED_OUT` (+ `details.event`, `details.filter`: the endpoint's filter would drop this payload), 409
 * `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN`, 422 for an event no installed module declares.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.trigger', scope: 'TENANT' });

    const body = await request.json();
    const parsed = TriggerWebhookDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    await assertSubscribableEvents(tenantId, [parsed.data.event]);
    const deliveryId = await WebhookService.triggerEvent(tenantId, webhookId, parsed.data.event, parsed.data.payload ?? {}, auth?.user?.userId ?? null);
    return NextResponse.json({ message: 'Event triggered.', deliveryId }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
