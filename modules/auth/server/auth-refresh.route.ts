import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
// path: app/tenant/[tenantId]/api/auth/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import UserSessionService from "@kuraykaraaslan-labs/user_session/server/user_session.service";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { RefreshTokenDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { sessionCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import { noteRefreshRefused } from "@kuraykaraaslan-labs/auth/server/auth.firewall-emitters";

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get("refreshToken")?.value;

  if (!refreshToken) {
    return NextResponse.json({ message: AuthMessages.INVALID_TOKEN }, { status: 401 });
  }

  const parsedData = RefreshTokenDTO.safeParse({ refreshToken });

  if (!parsedData.success) {
    return NextResponse.json({
      message: parsedData.error.issues.map((err: any) => err.message).join(", ")
    }, { status: 400 });
  }

  try {
    await Limiter.checkRateLimit(request, 'api');
        const { rawAccessToken, rawRefreshToken, userSession } = await UserSessionService.refreshTokens(refreshToken);

    const response = NextResponse.json({ message: AuthMessages.TOKENS_REFRESHED_SUCCESSFULLY });

    // Keep the cookie alive as long as the session it carries — 30d for a
    // "remember me" session (stamped in the session metadata at login), 7d
    // otherwise — and scoped to the SESSION's own tenant (not a URL param;
    // this route has none), so a refresh never widens the cookie's reach.
    const cookieOptions = sessionCookieOptions({
      request,
      tenantId: userSession.tenantId,
      rememberMe: userSession?.metadata?.rememberMe === true,
    });

    response.cookies.set("accessToken", rawAccessToken, cookieOptions);
    response.cookies.set("refreshToken", rawRefreshToken, cookieOptions);

    return response;

  } catch (e: unknown) {
    // The status code here is load-bearing: the axios interceptor sends the user
    // to login when a refresh fails. This used to answer 500 for *everything*,
    // so a rate-limited refresh (Limiter throws a 429 AppError) or a momentary
    // DB/redis blip logged the user out even though the session was perfectly
    // alive. normalizeError preserves each AppError's own status — 401 for a
    // genuinely dead session, 429 for rate limiting, 500 only for real faults —
    // and the client now only abandons the session on 401/403.
    // Phase 55 02.6: a refused token (revoked, expired, ...) is a signal for the AI firewall; a reuse is user_session's (D55-74); a 429 or a fault is not one.
    noteRefreshRefused(request, e, 'web');
    return normalizeError(e);
  }
}
