// path: app/tenant/[tenantId]/api/auth/me/sessions/route.ts
import { NextRequest, NextResponse } from 'next/server';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserSessionCrudService from '@kuraykaraaslan-labs/user_session/server/user_session.crud.service';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { AppError, ErrorCode } from '@kuraykaraaslan-labs/common/server/app-error';

/**
 * GET /tenant/[tenantId]/api/auth/me/sessions
 * Tenant-scoped /api/auth/me endpoint.
 * Returns all of the current user's active sessions: not expired and (D28) not idle, newest first, each with `lastActiveAt`.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user, userSession } = await authorizeRequest({
      request,
      requiredPermission: 'account.sessions.read',
      scope: 'ACCOUNT',
    });

    // The caller's own session is always listed: it is making this request, whatever its idle clock says.
    const sessions = await UserSessionCrudService.getUserSessions(user.userId, userSession.userSessionId);
    return NextResponse.json({ sessions });
  } catch (e) {
    return normalizeError(e);
  }
}

/**
 * DELETE /tenant/[tenantId]/api/auth/me/sessions
 * "Sign out all other sessions" (D28): ends every session of the current user except the one making the request, in every
 * organization (the list shows them all). The user id comes from the session, never from the request. An impersonation or break-glass
 * session is refused (403): the person at the keyboard is not the account owner, and must not sign the owner out of their own devices.
 */
export async function DELETE(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const { user, userSession } = await authorizeRequest({
      request,
      requiredPermission: 'account.sessions.manage',
      scope: 'ACCOUNT',
    });

    const meta = (userSession as { metadata?: { impersonation?: unknown; breakGlass?: unknown } | null }).metadata;
    if (meta?.impersonation || meta?.breakGlass) {
      throw new AppError('An impersonation session cannot sign the account out of its other sessions.', 403, ErrorCode.FORBIDDEN);
    }

    const count = await UserSessionCrudService.deleteOtherSessions(user.userId, userSession.userSessionId);
    return NextResponse.json({ message: 'Other sessions signed out.', count });
  } catch (e) {
    return normalizeError(e);
  }
}
