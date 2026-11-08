import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { NextRequest, NextResponse } from "next/server";
import { sessionCookieOptions } from "@kuraykaraaslan-labs/user_session/server/user_session.cookie.next";
import UserSessionTokenService from "@kuraykaraaslan-labs/user_session/server/user_session.token.service";
import { noteCallbackRefused } from "@kuraykaraaslan-labs/auth/server/auth.firewall-emitters";

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ tenantId: string }> }
) {
    try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'api');
            const { accessToken, refreshToken } = await request.json();

        // Login CSRF / session fixation: an access token that does not verify is never planted as a cookie (this route is
        // unauthenticated, so anyone could otherwise sign a victim's browser into a session of their choosing).
        if (accessToken) {
            try {
                UserSessionTokenService.verifyAccessToken(accessToken);
            } catch {
                // Phase 55 02.6: the refusal is a signal for the AI firewall (tallied; synchronous, never changes this answer).
                noteCallbackRefused(request, tenantId);
                return NextResponse.json({ success: false, error: 'Invalid session token' }, { status: 401 });
            }
        }

        const response = NextResponse.json({ success: true });

        const cookieOptions = sessionCookieOptions({ request, tenantId });

        if (accessToken) response.cookies.set('accessToken', accessToken, cookieOptions);
        if (refreshToken) response.cookies.set('refreshToken', refreshToken, cookieOptions);

        return response;
    } catch {
        // E-17: the raw error text (rate limiter, JSON parser) is not echoed.
        return NextResponse.json({ success: false, error: 'Bad request' }, { status: 400 });
    }
}
