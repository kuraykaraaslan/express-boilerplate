import { Router, Request, Response } from 'express';
import { AppError, ErrorCode } from '@/modules_express/common/app-error';
import UserSessionService from '@/modules/user_session/user_session.service';
import { RefreshTokenDTO } from '@/modules/auth/auth.dto';
import { UserSessionMessages } from '@/modules/user_session/user_session.messages';

const UserSessionRouter = Router();

UserSessionRouter.get('/', async (request: Request, response: Response) => {
  response.json({
    user: request.user,
    userSession: request.userSession,
  });
});

UserSessionRouter.post('/refresh', async (request: Request, response: Response) => {
  const tokenFromCookie = request.cookies?.refreshToken as string | undefined;
  const tokenFromBody = request.body?.refreshToken as string | undefined;
  const refreshToken = tokenFromCookie ?? tokenFromBody;

  if (!refreshToken) {
    throw new AppError(UserSessionMessages.INVALID_TOKEN, 401, ErrorCode.UNAUTHORIZED);
  }

  const parsed = RefreshTokenDTO.safeParse({ refreshToken });
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  const { userSession, rawAccessToken, rawRefreshToken } =
    await UserSessionService.refreshTokens(parsed.data.refreshToken);

  const isProduction = process.env.NODE_ENV === 'production';

  response.cookie('accessToken', rawAccessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  response.cookie('refreshToken', rawRefreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  response.json({
    userSession,
    accessToken: rawAccessToken,
    refreshToken: rawRefreshToken,
  });
});

UserSessionRouter.delete('/', async (request: Request, response: Response) => {
  if (!request.userSession) {
    throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);
  }

  await UserSessionService.deleteSession(request.userSession.userSessionId);

  const isProduction = process.env.NODE_ENV === 'production';

  response.clearCookie('accessToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });
  response.clearCookie('refreshToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });

  response.json({ message: 'LOGGED_OUT_SUCCESSFULLY' });
});

UserSessionRouter.delete('/all', async (request: Request, response: Response) => {
  if (!request.user) {
    throw new AppError(UserSessionMessages.SESSION_NOT_FOUND, 401, ErrorCode.UNAUTHORIZED);
  }

  await UserSessionService.deleteAllSessions(request.user.userId);

  const isProduction = process.env.NODE_ENV === 'production';

  response.clearCookie('accessToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });
  response.clearCookie('refreshToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });

  response.json({ message: 'ALL_SESSIONS_DELETED' });
});

export default UserSessionRouter;
