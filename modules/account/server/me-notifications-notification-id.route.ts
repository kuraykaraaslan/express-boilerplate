// path: app/tenant/[tenantId]/api/auth/me/notifications/[notificationId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import NotificationInAppService from "@kuraykaraaslan-labs/notification_inapp/server/notification_inapp.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * PUT /tenant/[tenantId]/api/auth/me/notifications/[notificationId]
 * Mark a single notification as read.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; notificationId: string }> }
) {
  try {
    const { tenantId, notificationId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.notifications.manage',
      scope: 'ACCOUNT',
    });

    await NotificationInAppService.markAsRead(tenantId, user.userId, notificationId);
    return NextResponse.json({ message: "Notification marked as read" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/auth/me/notifications/[notificationId]
 * Remove a single notification from the inbox.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; notificationId: string }> }
) {
  try {
    const { tenantId, notificationId } = await params;
    await Limiter.checkRateLimit(request);
    const { user } = await authorizeRequest({
      request,
      requiredPermission: 'account.notifications.manage',
      scope: 'ACCOUNT',
    });

    await NotificationInAppService.deleteOne(tenantId, user.userId, notificationId);
    return NextResponse.json({ message: "Notification removed" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
