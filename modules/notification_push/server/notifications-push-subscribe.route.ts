import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import NotificationPushService from "./notification_push.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { z } from "zod";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { isPublicPushEndpoint } from "./notification_push.endpoint-guard";

const SubscribeDTO = z.object({
  // notification_push.03 (fixed 2026-10-20): bounded like the columns and the Web Push spec (a P-256 key is 87 base64url characters,
  // the auth secret 22): a 1 MB key or endpoint used to be stored, cached and read back on every send.
  endpoint: z.string().max(2048).url().refine(isPublicPushEndpoint, 'The endpoint must be a public https push service'),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(64),
  }),
});

/**
 * POST /tenant/[tenantId]/api/notifications/push/subscribe
 * Register a push subscription for the current user, scoped to this tenant.
 * The same browser endpoint may also be subscribed to other tenants the
 * user belongs to — the composite (tenantId, endpoint) unique key allows it.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Member subscribing own device; ABAC floor USER (self-service)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'notification_push.subscription.subscribe', scope: 'TENANT' });

    const body = await request.json();
    const parsed = SubscribeDTO.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(", ") }, { status: 400 });
    }

    await NotificationPushService.subscribe(tenantId, user.userId, parsed.data);

    return NextResponse.json({ message: "Push subscription saved" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/notifications/push/subscribe
 * Optional ?endpoint=... to remove a single subscription. Without it, all
 * subscriptions for the user in this tenant are removed.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    // Member removing own device subscription; ABAC floor USER (self-service)
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'notification_push.subscription.unsubscribe', scope: 'TENANT' });

    const endpoint = request.nextUrl.searchParams.get('endpoint');
    if (endpoint) {
      // Confined to the caller's own row: an endpoint is not a credential for deleting someone else's.
      await NotificationPushService.unsubscribeByEndpoint(tenantId, endpoint, user.userId);
    } else {
      await NotificationPushService.unsubscribe(tenantId, user.userId);
    }

    return NextResponse.json({ message: "Push subscription removed" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
