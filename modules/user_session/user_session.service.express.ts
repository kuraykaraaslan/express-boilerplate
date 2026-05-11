import { Request } from 'express';
import { AppError, ErrorCode } from '@/libs/app-error';
import { SafeUser } from '@/modules/user/user.types';
import { SafeUserSession } from './user_session.types';
import UserSessionService from './user_session.service';
import { UserSessionMessages } from './user_session.messages';

/**
 * Express-specific session helper.
 * Reads accessToken from cookie or Authorization header, validates the session,
 * and attaches user + userSession to the request object.
 */
export async function authenticateUserByRequest(
  request: Request,
): Promise<{ user: SafeUser; userSession: SafeUserSession }> {
  const tokenFromCookie = request.cookies?.accessToken as string | undefined;
  const tokenFromHeader = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];

  if (tokenFromCookie && tokenFromHeader) {
    throw new AppError('TWO_AUTH_SOURCES', 401, ErrorCode.UNAUTHORIZED);
  }

  const accessToken = tokenFromCookie ?? tokenFromHeader;

  if (!accessToken) {
    throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);
  }

  const { user, userSession } = await UserSessionService.getSessionDangerously(
    { accessToken },
    request,
  );

  request.user = user;
  request.userSession = userSession;

  return { user, userSession };
}
