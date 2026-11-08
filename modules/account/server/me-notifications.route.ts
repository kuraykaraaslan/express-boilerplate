// path: app/tenant/[tenantId]/api/auth/me/notifications/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import NotificationInAppService from "@kuraykaraaslan-labs/notification_inapp/server/notification_inapp.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * GET /tenant/[tenantId]/api/auth/me/notifications
 * Inbox of the authenticated user, scoped to {tenantId}. Notifications
 * pushed against other tenants are invisible here.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.notifications.read',
      scope: 'ACCOUNT',
    });

    const notifications = await NotificationInAppService.getAll(tenantId, user.userId);
    return NextResponse.json({ notifications }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/auth/me/notifications
 * Clear the entire inbox for this user/tenant pair.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.notifications.manage',
      scope: 'ACCOUNT',
    });

    await NotificationInAppService.clearAll(tenantId, user.userId);
    return NextResponse.json({ message: "Inbox cleared" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
