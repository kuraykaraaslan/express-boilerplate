// path: app/tenant/[tenantId]/api/auth/device/refresh/route.ts
import { NextRequest, NextResponse } from "next/server";
import Limiter from "@kuraykaraaslan-labs/limiter/server/limiter.service.next";
import UserSessionService from "@kuraykaraaslan-labs/user_session/server/user_session.service";
import AuthMessages from "@kuraykaraaslan-labs/auth/server/auth.messages";
import { RefreshTokenDTO } from "@kuraykaraaslan-labs/auth/server/auth.dto";
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";
import { noteRefreshRefused } from "@kuraykaraaslan-labs/auth/server/auth.firewall-emitters";

/**
 * Device-bearer counterpart of auth-refresh.route.ts — the refresh token
 * travels in the JSON body (there is no cookie to read it from) and is
 * verified against the `device` audience, so a refresh token minted for the
 * web cookie flow cannot be replayed here and vice versa. Rotation,
 * reuse-detection and the tenant binding all reuse the exact same
 * UserSessionService.refreshTokens the web route calls — audience is the
 * only thing that differs.
 */
export async function POST(request: NextRequest) {
  try {
    await Limiter.checkRateLimit(request, 'api');
    const body = await request.json();
    const parsedData = RefreshTokenDTO.safeParse(body);

    if (!parsedData.success) {
      return NextResponse.json({
        message: parsedData.error.issues.map((err) => err.message).join(", ")
      }, { status: 400 });
    }

    const { rawAccessToken, rawRefreshToken } = await UserSessionService.refreshTokens(parsedData.data.refreshToken, 'device');

    return NextResponse.json({
      message: AuthMessages.TOKENS_REFRESHED_SUCCESSFULLY,
      accessToken: rawAccessToken,
      refreshToken: rawRefreshToken,
    });

  } catch (e: unknown) {
    // Same status-preserving behaviour as the web refresh route: a 401 means
    // "sign in again", anything else means "retry" — the client must not
    // treat a rate limit or transient fault as a dead session.
    // Phase 55 02.6: a refused token (revoked, expired, ...) is a signal for the AI firewall; a reuse is user_session's (D55-74); a 429 or a fault is not one.
    noteRefreshRefused(request, e, 'device');
    return normalizeError(e);
  }
}
