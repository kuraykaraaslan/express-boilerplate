import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { ListDeliveriesDTO } from '@kuraykaraaslan-labs/webhook/server/webhook.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/webhooks/[webhookId]/deliveries
 * List delivery attempts for a webhook (ADMIN+): the list contract, `{ data, total }` (41-ui-fixes/12 3.8). Each row has
 * the list's columns only (`WebhookDeliveryListRow`: no payload, request body or response body).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.deliveries.read', scope: 'TENANT' });

    const parsed = ListDeliveriesDTO.safeParse({
      // Empty params are left out so the defaults apply.
      ...Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== '')),
      tenantId,
      webhookId,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    const { deliveries, total } = await WebhookService.listDeliveries(parsed.data);
    return NextResponse.json({ data: deliveries, total }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
