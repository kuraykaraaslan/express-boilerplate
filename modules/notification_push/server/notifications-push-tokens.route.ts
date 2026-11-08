import { NextRequest, NextResponse } from 'next/server';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import NotificationPushService from './notification_push.service';
import { RegisterPushTokenDTO, UnregisterPushTokenQuery, UpdatePushTokenCategoriesDTO } from './notification_push.dto';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { normalizeError } from '@kuraykaraaslan-labs/common/server/route-error';

/**
 * POST /tenant/[tenantId]/api/notifications/push/tokens
 * Register a native-app push token (Expo) for the signed-in user in this tenant.
 * Body `{ provider: 'expo', token, platform: 'ios'|'android', deviceId?, appVersion?, categories? }`.
 *
 * The device bearer token is bound to one tenant, so a token is registered per tenant the
 * app is signed in to. The token is bound to the session it was registered under: signing out
 * (or revoking that session in any way) removes it. Idempotent: registering the same token
 * again refreshes it; a token already registered by another account on this tenant is re-bound
 * to the caller.
 *
 * 200 `{ message }`; 400 validation; 429 `SUBSCRIPTION_LIMIT_REACHED` past the per-user cap.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user, userSession } = await authorizeRequest({ request, tenantId, requiredPermission: 'notification_push.subscription.subscribe', scope: 'TENANT' });

    const parsed = RegisterPushTokenDTO.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }

    await NotificationPushService.registerDeviceToken(tenantId, user.userId, parsed.data, userSession.userSessionId);
    return NextResponse.json({ message: 'Push token saved' }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/notifications/push/tokens?deviceId=… | ?token=…
 * Unregister the caller's own token (e.g. when the user turns notifications off). Signing out
 * already removes it, since a token is bound to its session. Only ever touches the caller's own rows.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'notification_push.subscription.unsubscribe', scope: 'TENANT' });

    const sp = request.nextUrl.searchParams;
    const parsed = UnregisterPushTokenQuery.safeParse({
      deviceId: sp.get('deviceId') ?? undefined,
      token: sp.get('token') ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }

    await NotificationPushService.unregisterDeviceToken(tenantId, user.userId, parsed.data);
    return NextResponse.json({ message: 'Push token removed' }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * PATCH /tenant/[tenantId]/api/notifications/push/tokens
 * Body `{ deviceId | token, categories }`. Changes the categories of the caller's own token
 * without re-registering. 200; 400 validation; 404 when none of the caller's tokens match.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({ request, tenantId, requiredPermission: 'notification_push.subscription.subscribe', scope: 'TENANT' });

    const parsed = UpdatePushTokenCategoriesDTO.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ message: parsed.error.issues.map((i) => i.message).join(', ') }, { status: 400 });
    }

    const { categories, ...by } = parsed.data;
    const changed = await NotificationPushService.updateDeviceTokenCategories(tenantId, user.userId, by, categories);
    if (!changed) return NextResponse.json({ message: 'Push token not found' }, { status: 404 });
    return NextResponse.json({ message: 'Push token updated' }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
