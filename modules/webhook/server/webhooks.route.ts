import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookCrudService from '@kuraykaraaslan-labs/webhook/server/webhook.crud.service';
import { CreateWebhookDTO, ListWebhooksQuery } from '@kuraykaraaslan-labs/webhook/server/webhook.dto';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/webhooks
 * List webhook endpoints (ADMIN+)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.read', scope: 'TENANT' });

    // Empty params are left out so the defaults apply.
    const parsed = ListWebhooksQuery.safeParse({
      ...Object.fromEntries([...new URL(request.url).searchParams].filter(([, v]) => v !== '')),
      tenantId,
    });

    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    const { webhooks, total } = await WebhookCrudService.list(parsed.data);
    // `webhooks` stays for existing clients; `data` is the list contract's name for the rows.
    return NextResponse.json({ webhooks, data: webhooks, total }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/webhooks
 * Create a new webhook endpoint (ADMIN+). 201 `{ webhook, secret }`: `secret` is the endpoint's signing secret, in this
 * answer ONLY (41-ui-fixes/12 1.3, decision a); no other answer (list, get, update) ever carries it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.create', scope: 'TENANT' });

    const body = await request.json();
    const parsed = CreateWebhookDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { message: parsed.error.issues.map((i) => i.message).join(', ') },
        { status: 400 },
      );
    }

    const { webhook, secret } = await WebhookCrudService.createWithSecret(tenantId, user.userId, parsed.data);
    // ⚠️ Returned exactly once — the client shows it now and keeps nothing.
    return NextResponse.json({ webhook, secret }, { status: 201, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}
