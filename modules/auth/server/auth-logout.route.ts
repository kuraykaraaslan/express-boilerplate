// path: app/tenant/[tenantId]/api/auth/logout/route.ts
import { NextRequest, NextResponse } from "next/server";
import UserSessionNextService from "@kuraykaraaslan-labs/user_session/server/user_session.service.next";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import { sessionCookiePath } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> }
) {
  const { tenantId } = await params;
  // A clearing `set` only removes a cookie whose name+path match exactly —
  // in path-mode tenancy the cookie was minted with `path: /t/{tenantId}`
  // (see sessionCookieOptions), so the clear must target the same path or
  // it silently no-ops and leaves the session cookie alive.
  const path = sessionCookiePath(tenantId);

  try {
    await Limiter.checkRateLimit(request);
    await UserSessionNextService.logout({ request });

    const response = NextResponse.json({
      success: true,
      message: 'Logged out successfully'
    }, { status: 200 });

    // Clear cookies
    response.cookies.set('accessToken', '', { maxAge: 0, path });
    response.cookies.set('refreshToken', '', { maxAge: 0, path });

    return response;

  } catch {
    // The cookies are cleared either way, but the answer no longer claims success (auth.09): the server-side session (and
    // its refresh token) may still be alive, so the client is told to retry. The error text is never echoed.
    const response = NextResponse.json({
      success: false,
      message: 'Logged out on this device, but the session could not be ended on the server. Please try again.'
    }, { status: 503 });

    response.cookies.set('accessToken', '', { maxAge: 0, path });
    response.cookies.set('refreshToken', '', { maxAge: 0, path });

    return response;
  }
}
