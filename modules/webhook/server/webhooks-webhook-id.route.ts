import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookCrudService from '@kuraykaraaslan-labs/webhook/server/webhook.crud.service';
import { UpdateWebhookDTO } from '@kuraykaraaslan-labs/webhook/server/webhook.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/webhooks/[webhookId]
 * Get a single webhook endpoint (ADMIN+)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.read', scope: 'TENANT' });

    const webhook = await WebhookCrudService.getById(tenantId, webhookId);
    return NextResponse.json({ webhook }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PATCH /tenant/[tenantId]/api/webhooks/[webhookId]
 * Update a webhook endpoint (ADMIN+)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.update', scope: 'TENANT' });

    const body = await request.json();
    const parsed = UpdateWebhookDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    const webhook = await WebhookCrudService.update(tenantId, webhookId, parsed.data, auth?.user?.userId ?? null); // webhook.07
    return NextResponse.json({ webhook }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/webhooks/[webhookId]
 * Delete a webhook endpoint (ADMIN+)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.delete', scope: 'TENANT' });

    await WebhookCrudService.delete(tenantId, webhookId, auth?.user?.userId ?? null); // webhook.07
    return NextResponse.json({ message: 'Webhook deleted successfully.' }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
