import Logger from '@kuraykaraaslan-labs/logger';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcrypt';
import { getDataSource } from '@kuraykaraaslan-labs/db';
import { User as UserEntity } from '@kuraykaraaslan-labs/user/server/entities/user.entity';
import Limiter from '@kuraykaraaslan-labs/limiter/server/limiter.service.next';
import { authorizeRequest } from '@kuraykaraaslan-labs/auth_abac/server/auth_abac.guard.next';
import UserSecurityService from '@kuraykaraaslan-labs/user_security/server/user_security.service';
import UserSessionService from '@kuraykaraaslan-labs/user_session/server/user_session.service';
import AuthService from '@kuraykaraaslan-labs/auth/server/auth.service';
import { ChangePasswordDTO } from '@kuraykaraaslan-labs/auth/server/auth.dto';
import AuthMessages from '@kuraykaraaslan-labs/auth/server/auth.messages';
import { sessionCookieOptions } from '@kuraykaraaslan-labs/user_session/server/user_session.cookie.next';
import { normalizeError } from "@kuraykaraaslan-labs/common/server/route-error";

/**
 * POST /api/tenant/{tenantId}/auth/change-password
 *
 * Same contract as the system route, but uses the tenantId for policy
 * resolution so tenant-level overrides (KD-5 / KD-7) take effect.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantId: string }> },
) {
  try {
    const { tenantId } = await params;
    await Limiter.checkRateLimit(request, 'auth');
    const { user, userSession } = await authorizeRequest({
      request,
      requiredPermission: 'auth.account.change_password',
      scope: 'ACCOUNT',
      requiredUserRole: 'USER',
    });

    const body = await request.json();
    const parsed = ChangePasswordDTO.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
    }
    const { currentPassword, newPassword } = parsed.data;

    const ds = await getDataSource();
    const dbUser = await ds.getRepository(UserEntity).findOne({ where: { userId: user.userId } });
    if (!dbUser) {
      return NextResponse.json({ error: AuthMessages.USER_NOT_FOUND }, { status: 404 });
    }

    // A Fleet ID shadow user has no password to change here (FID-07).
    const ok = dbUser.password ? await bcrypt.compare(currentPassword, dbUser.password) : false;
    if (!ok) {
      return NextResponse.json({ error: AuthMessages.INVALID_CREDENTIALS }, { status: 401 });
    }

    await AuthService.changePassword({ userId: user.userId, newPassword, tenantId });

    await UserSessionService.deleteOtherSessions(user.userId, userSession.userSessionId).catch(
      (err: unknown) => Logger.warn(`change-password (tenant): failed to clear sibling sessions: ${err instanceof Error ? err.message : err}`),
    );
    // 38-security 3.4: trusted devices end with the old password; the person trusts this browser again at the next step-up.
    await UserSecurityService.revokeTrustedDevices(user.userId).catch(
      (err: unknown) => Logger.warn(`change-password (tenant): failed to revoke trusted devices: ${err instanceof Error ? err.message : err}`),
    );
    // auth.05: the forced change-password step is done; this session may use the app again. Not best-effort: a failure
    // here would leave the person stuck on the change-password page with a password that already changed.
    await UserSessionService.clearPasswordChangeRequired(user.userId);

    const response = NextResponse.json({ message: AuthMessages.PASSWORD_RESET_SUCCESSFUL }, { status: 200 });

    // 38-security 1.7: a privilege-sensitive event rotates the current session's token pair too (the siblings are gone above),
    // so a copy of the pre-change access or refresh token is dead. Cookie sessions only: a bearer (device) caller has no refresh
    // cookie and keeps its pair. A failed rotation is logged, never fatal: the password already changed and the session is valid.
    const refreshToken = request.cookies.get('refreshToken')?.value;
    if (refreshToken) {
      try {
        const rotated = await UserSessionService.refreshTokens(refreshToken);
        const cookieOptions = sessionCookieOptions({
          request,
          tenantId: rotated.userSession.tenantId,
          rememberMe: rotated.userSession?.metadata?.rememberMe === true,
        });
        response.cookies.set('accessToken', rotated.rawAccessToken, cookieOptions);
        response.cookies.set('refreshToken', rotated.rawRefreshToken, cookieOptions);
      } catch (err: unknown) {
        Logger.warn(`change-password (tenant): failed to rotate the current session: ${err instanceof Error ? err.message : err}`);
      }
    }

    return response;
  } catch (e) {
    return normalizeError(e);
  }
}
