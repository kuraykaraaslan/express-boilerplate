import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookCrudService from '@kuraykaraaslan-labs/webhook/server/webhook.crud.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /tenant/[tenantId]/api/webhooks/[webhookId]/rotate-secret
 *
 * Rotates a webhook's HMAC signing secret. The previous secret is retained for
 * an overlap window (default 48h) so subscribers can update their verifier
 * without dropping events — during the window both `X-Webhook-Signature` and
 * `X-Webhook-Signature-Prev` are emitted.
 *
 * Returns the new secret in the response body **exactly once**. Persist it on
 * the client side immediately — subsequent reads of the webhook never expose
 * the raw value.
 *
 * Optional body: `{ "overlapHours": number }` (default 48, range 1..168).
 *
 * While the previous secret's overlap window still runs, only the current secret is replaced: the previous one keeps
 * its end date and `overlapHours` is not applied (41-ui-fixes/12 1.7). `webhook.previousSecretExpiresAt` in the answer
 * is the previous secret's end date either way.
 *
 * Auth: tenant ADMIN.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.endpoints.rotate_secret', scope: 'TENANT' });

    let overlapMs = 48 * 60 * 60 * 1000;
    try {
      const body = await request.json();
      if (typeof body?.overlapHours === 'number' && body.overlapHours > 0 && body.overlapHours <= 168) {
        overlapMs = body.overlapHours * 60 * 60 * 1000;
      }
    } catch {
      // Empty body is fine — use default.
    }

    const { webhook, newSecret } = await WebhookCrudService.rotateSecret(tenantId, webhookId, overlapMs, auth?.user?.userId ?? null); // webhook.07

    return NextResponse.json(
      {
        webhook,
        // ⚠️ Returned exactly once — clients MUST capture it now.
        newSecret,
        overlapMs,
      },
      { status: 200 },
    );
  } catch (e) {
    return normalizeError(e);
  }
}
