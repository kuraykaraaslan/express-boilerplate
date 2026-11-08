import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import WebhookService from '@kuraykaraaslan-labs/webhook/server/webhook.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/webhooks/[webhookId]/deliveries/replay-dead-letter
 *
 * How many dead letters the POST below would re-send right now (its own criteria: DEAD_LETTERED, test sends excluded, no
 * time window). 200 `{ count }`. The console shows it in the replay's confirm; it needs the replay's permission only, not
 * `webhook.reports.read` (41-ui-fixes/12 1.4).
 *
 * Auth: the replay's permission (`webhook.deliveries.replay`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; webhookId: string }> },
) {
  try {
    const { tenantId, webhookId } = await params;
    await Limiter.checkRateLimit(request);
    await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.deliveries.replay', scope: 'TENANT' });

    const count = await WebhookService.countReplayableDeadLetters(tenantId, webhookId);
    return NextResponse.json({ count }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * POST /tenant/[tenantId]/api/webhooks/[webhookId]/deliveries/replay-dead-letter
 *
 * Bulk-replays every `DEAD_LETTERED` delivery for a webhook (test sends excluded, no time window). Each row is
 * claimed (DEAD_LETTERED → PENDING, attempts 0) and re-queued with its original body — the receiver
 * sees the same event body it would have seen the first time. A row another request claimed first is skipped.
 * 200 `{ message, replayed, skipped }`. Refusals: 409 `ENDPOINT_DISABLED`, 403 `WEBHOOKS_NOT_IN_PLAN` (`details.reason`).
 * The count to show before confirming is this route's GET (same criteria, same permission).
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
    const auth = await authorizeRequest({ request, tenantId, requiredPermission: 'webhook.deliveries.replay', scope: 'TENANT' });

    const { replayed, skipped } = await WebhookService.replayDeadLettered(tenantId, webhookId, auth?.user?.userId ?? null);
    return NextResponse.json({ message: `${replayed} dead-lettered deliveries re-queued.`, replayed, skipped }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
