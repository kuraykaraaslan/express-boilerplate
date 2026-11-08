// path: app/tenant/[tenantId]/api/auth/me/sessions/[sessionId]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserSessionCrudService from '@kuraykaraaslan-labs/user_session/server/user_session.crud.service';
import UserSessionMessages from '@kuraykaraaslan-labs/user_session/server/user_session.messages';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * DELETE /tenant/[tenantId]/api/auth/me/sessions/[sessionId]
 * Tenant-scoped /api/auth/me endpoint.
 * Revokes one of the current user's sessions.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string; sessionId: string }> },
) {
  try {
    const { sessionId } = await params;
    await Limiter.checkRateLimit(request, 'api');
    const { user, userSession } = await authorizeRequest({
      request,
      requiredPermission: 'account.sessions.manage',
      scope: 'ACCOUNT',
    });

    const sessions = await UserSessionCrudService.getUserSessions(user.userId);
    const target = sessions.find((s) => s.userSessionId === sessionId);

    if (!target) {
      return NextResponse.json({ message: UserSessionMessages.SESSION_NOT_FOUND }, { status: 404 });
    }

    await UserSessionCrudService.deleteSession(sessionId);

    return NextResponse.json({
      message: 'Session revoked.',
      isCurrentSession: userSession.userSessionId === sessionId,
    });
  } catch (e) {
    return normalizeError(e);
  }
}
