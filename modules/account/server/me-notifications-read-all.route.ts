// path: app/tenant/[tenantId]/api/auth/me/notifications/read-all/route.ts
import { NextRequest, NextResponse } from "next/server";
import { authorizeRequest } from "@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next";
import NotificationInAppService from "@kuraykaraaslan-labs/notification_inapp/server/notification_inapp.service";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * PUT /tenant/[tenantId]/api/auth/me/notifications/read-all
 * Mark every notification in the user's tenant-scoped inbox as read.
 */
export async function PUT(
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

    await NotificationInAppService.markAllAsRead(tenantId, user.userId);
    return NextResponse.json({ message: "All notifications marked as read" }, { status: 200 });
  } catch (e) {
    return normalizeError(e);
  }
}
