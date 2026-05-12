import { Request } from 'express';
import { AppError, ErrorCode } from '@/modules/common/app-error';
import { SafeUser } from '@/modules/user/user.types';
import { SafeUserSession } from '@/modules/user_session/user_session.types';
import UserSessionService from '@/modules/user_session/user_session.service';
import UserSessionMessages from '@/modules/user_session/user_session.messages';
import AuthMessages from '@/modules/auth/auth.messages';
import UserService from '@/modules/user/user.service';

export default class UserSessionExpressService {

  static generateDeviceFingerprint(request: Request): string {
    const rawIp =
      request.headers['x-real-ip'] ||
      request.headers['x-forwarded-for'] ||
      request.socket.remoteAddress;
    const rawIpStr = Array.isArray(rawIp) ? rawIp[0] : rawIp;
    return UserSessionService.generateDeviceFingerprint({
      ip: typeof rawIpStr === 'string' ? rawIpStr.split(',')[0].trim() : undefined,
      userAgent: request.headers['user-agent'] || undefined,
      acceptLanguage: request.headers['accept-language'] || undefined,
    });
  }

  static async getSession({
    accessToken,
    request,
    otpVerifyBypass = false,
  }: {
    accessToken: string;
    request: Request;
    otpVerifyBypass?: boolean;
  }): Promise<{ user: SafeUser; userSession: SafeUserSession }> {
    const deviceFingerprint = UserSessionExpressService.generateDeviceFingerprint(request);
    const userSession = await UserSessionService.getSession({ accessToken, deviceFingerprint, otpVerifyBypass });
    const user = await UserService.getById(userSession.userId);
    return { user, userSession };
  }

  static async authenticateUserByRequest({
    request,
    requiredUserRole = 'USER',
    otpVerifyBypass = false,
  }: {
    request: Request;
    requiredUserRole?: string;
    otpVerifyBypass?: boolean;
  }): Promise<{ user: SafeUser; userSession: SafeUserSession }> {
    const tokenFromCookie = request.cookies?.accessToken as string | undefined;
    const tokenFromHeader = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

    if (tokenFromCookie && tokenFromHeader) {
      throw new AppError(AuthMessages.TWO_AUTH_SOURCES, 401, ErrorCode.UNAUTHORIZED);
    }

    const accessToken = tokenFromCookie ?? tokenFromHeader;

    if (!accessToken) {
      throw new AppError(UserSessionMessages.USER_NOT_AUTHENTICATED, 401, ErrorCode.UNAUTHORIZED);
    }

    const { user, userSession } = await UserSessionExpressService.getSession({
      accessToken,
      request,
      otpVerifyBypass,
    });

    const roleHierarchy = ['GUEST', 'USER', 'ADMIN'];
    const requiredIndex = roleHierarchy.indexOf(requiredUserRole);
    const userIndex = roleHierarchy.indexOf(user.userRole);

    if (userIndex < requiredIndex) {
      throw new AppError(UserSessionMessages.USER_DOES_NOT_HAVE_REQUIRED_ROLE, 403, ErrorCode.FORBIDDEN);
    }

    request.user = user;
    request.userSession = userSession;

    return { user, userSession };
  }
}
