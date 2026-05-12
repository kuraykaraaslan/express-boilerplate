import { Router, Request, Response } from 'express';

import { AppError, ErrorCode } from '@/modules/common/app-error';
import Limiter from '@/modules_express/limiter/limiter.service.express';

import AuthService from '@/modules/auth/auth.service';
import AuthPasswordService from '@/modules/auth/auth.password.service';
import AuthOTPService from '@/modules/auth/auth.otp.service';
import AuthTOTPService from '@/modules/auth/auth.totp.service';
import AuthMiddleware from '@/modules_express/auth/auth.middleware';
import AuthMessages from '@/modules/auth/auth.messages';

import {
  LoginDTO,
  RegisterDTO,
  ForgotPasswordDTO,
  ResetPasswordDTO,
  VerifyEmailDTO,
  RequestOTPDTO,
  VerifyOTPDTO,
} from '@/modules/auth/auth.dto';

import UserSessionService from '@/modules/user_session/user_session.service';
import UserSecurityService from '@/modules/user_security/user_security.service';
import UserSessionRouter from './user_session';

const AuthRouter = Router();

// ── Register ───────────────────────────────────────────────────────────────────

AuthRouter.post('/register', Limiter.useAuthLimiter, async (req: Request, res: Response) => {
  const parsed = RegisterDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  const { user } = await AuthService.register(parsed.data);
  const userSecurity = await UserSecurityService.getByUserId(user.userId);

  const { userSession, rawAccessToken, rawRefreshToken } =
    await UserSessionService.createSession({
      user,
      userSecurity,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

  const isProduction = req.app.get('env') === 'production';

  res.cookie('accessToken', rawAccessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.cookie('refreshToken', rawRefreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.status(201).json({
    message: AuthMessages.REGISTRATION_SUCCESSFUL,
    user,
    userSession,
  });
});

// ── Login ──────────────────────────────────────────────────────────────────────

AuthRouter.post('/login', Limiter.useAuthLimiter, async (req: Request, res: Response) => {
  const parsed = LoginDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  const { user } = await AuthService.login(parsed.data);
  const userSecurity = await UserSecurityService.getByUserId(user.userId);

  const { userSession, rawAccessToken, rawRefreshToken } =
    await UserSessionService.createSession({
      user,
      userSecurity,
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    });

  const isProduction = req.app.get('env') === 'production';

  res.cookie('accessToken', rawAccessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.cookie('refreshToken', rawRefreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 1000 * 60 * 60 * 24 * 7,
  });

  res.json({
    message: AuthMessages.LOGIN_SUCCESSFUL,
    user,
    userSession,
    accessToken: rawAccessToken,
    refreshToken: rawRefreshToken,
  });
});

// ── Forgot password ────────────────────────────────────────────────────────────

AuthRouter.post('/forgot-password', Limiter.useAuthLimiter, async (req: Request, res: Response) => {
  const parsed = ForgotPasswordDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthPasswordService.forgotPassword({ email: parsed.data.email });

  res.json({ message: AuthMessages.PASSWORD_RESET_EMAIL_SENT });
});

// ── Reset password ─────────────────────────────────────────────────────────────

AuthRouter.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = ResetPasswordDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthPasswordService.resetPassword({
    email: parsed.data.email,
    resetToken: parsed.data.resetToken,
    newPassword: parsed.data.newPassword,
  });

  res.json({ message: AuthMessages.PASSWORD_RESET_SUCCESSFUL });
});

// ── Routes below require authentication ───────────────────────────────────────

AuthRouter.use(AuthMiddleware('USER'));

// ── Logout ─────────────────────────────────────────────────────────────────────

AuthRouter.post('/logout', async (req: Request, res: Response) => {
  if (req.userSession) {
    await UserSessionService.deleteSession(req.userSession.userSessionId);
  }

  const isProduction = req.app.get('env') === 'production';

  res.clearCookie('accessToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });
  res.clearCookie('refreshToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });

  res.json({ message: AuthMessages.LOGGED_OUT_SUCCESSFULLY });
});

// ── Email verification ─────────────────────────────────────────────────────────

AuthRouter.post('/email-verification/send', async (req: Request, res: Response) => {
  const user = req.user!;
  await AuthService.sendEmailVerification({ userId: user.userId, email: user.email });
  res.json({ message: AuthMessages.EMAIL_VERIFICATION_SENT });
});

AuthRouter.post('/email-verification/verify', async (req: Request, res: Response) => {
  const parsed = VerifyEmailDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  const user = req.user!;
  await AuthService.verifyEmail({ userId: user.userId, token: parsed.data.token });

  res.json({ message: AuthMessages.EMAIL_VERIFIED_SUCCESSFULLY });
});

// ── OTP routes ─────────────────────────────────────────────────────────────────

AuthRouter.post('/otp/send', async (req: Request, res: Response) => {
  const parsed = RequestOTPDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthOTPService.requestOTP({
    user: req.user!,
    userSession: req.userSession!,
    method: parsed.data.method,
    action: parsed.data.action,
  });
  res.json({ message: AuthMessages.OTP_SENT_SUCCESSFULLY });
});

AuthRouter.post('/otp/verify', async (req: Request, res: Response) => {
  const parsed = VerifyOTPDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthOTPService.verifyOTP({
    user: req.user!,
    userSession: req.userSession!,
    method: parsed.data.method,
    action: parsed.data.action,
    otpToken: parsed.data.otpToken,
  });
  res.json({ message: AuthMessages.OTP_VERIFIED_SUCCESSFULLY });
});

// ── TOTP routes ────────────────────────────────────────────────────────────────

AuthRouter.post('/totp/setup', async (req: Request, res: Response) => {
  const { secret, otpauthUrl } = await AuthTOTPService.requestSetup({
    user: req.user!,
    userSession: req.userSession!,
  });
  res.json({ message: AuthMessages.TOTP_SETUP_INITIATED, secret, qrCodeUrl: otpauthUrl });
});

AuthRouter.post('/totp/enable', async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    throw new AppError('token is required', 400, ErrorCode.VALIDATION_ERROR);
  }

  const { backupCodes } = await AuthTOTPService.verifyAndEnable({
    user: req.user!,
    userSession: req.userSession!,
    otpToken: token,
  });
  res.json({ message: AuthMessages.TOTP_ENABLED_SUCCESSFULLY, backupCodes });
});

AuthRouter.post('/totp/disable', async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    throw new AppError('token is required', 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthTOTPService.disable({ user: req.user!, otpToken: token });
  res.json({ message: AuthMessages.TOTP_DISABLED_SUCCESSFULLY });
});

// ── Session sub-router ─────────────────────────────────────────────────────────

AuthRouter.use('/session', Limiter.useAuthLimiter, UserSessionRouter);

export default AuthRouter;
