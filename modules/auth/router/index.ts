import { Router, Request, Response } from 'express';

import { AppError, ErrorCode } from '@/libs/app-error';
import Limiter from '@/libs/limiter';

import AuthService from '../auth.service';
import AuthPasswordService from '../auth.password.service';
import AuthOTPService from '../auth.otp.service';
import AuthTOTPService from '../auth.totp.service';
import AuthMiddleware from '../middleware';
import AuthMessages from '../auth.messages';

import {
  LoginDTO,
  RegisterDTO,
  ForgotPasswordDTO,
  ResetPasswordDTO,
  VerifyEmailDTO,
  OTPSendDTO,
  OTPVerifyDTO,
} from '../auth.dto';

import UserSessionService from '@/modules/user_session/user_session.service';
import UserSessionRouter from '@/modules/user_session/router';

const AuthRouter = Router();

// ── Register ───────────────────────────────────────────────────────────────────

AuthRouter.post('/register', Limiter.useAuthLimiter, async (req: Request, res: Response) => {
  const parsed = RegisterDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  const user = await AuthService.register(parsed.data);

  const { userSession, rawAccessToken, rawRefreshToken } =
    await UserSessionService.createSession(user, req, false);

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

  const user = await AuthService.login(parsed.data);

  const { userSession, rawAccessToken, rawRefreshToken } =
    await UserSessionService.createSession(user, req, false);

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

  res.json({ message: AuthMessages.PASSWORD_RESET_SENT });
});

// ── Reset password ─────────────────────────────────────────────────────────────

AuthRouter.post('/reset-password', async (req: Request, res: Response) => {
  const parsed = ResetPasswordDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  const email = req.body.email as string;
  if (!email) {
    throw new AppError(
      AuthMessages.EITHER_EMAIL_OR_PHONE_MUST_BE_PROVIDED,
      400,
      ErrorCode.VALIDATION_ERROR,
    );
  }

  await AuthPasswordService.resetPassword({
    email,
    token: parsed.data.token,
    password: parsed.data.password,
  });

  res.json({ message: AuthMessages.PASSWORD_RESET_SUCCESSFUL });
});

// ── Routes below require authentication ───────────────────────────────────────

AuthRouter.use(AuthMiddleware('USER'));

// ── Logout ─────────────────────────────────────────────────────────────────────

AuthRouter.post('/logout', async (req: Request, res: Response) => {
  if (req.userSession) {
    await UserSessionService.deleteSession(req.userSession);
  }

  const isProduction = req.app.get('env') === 'production';

  res.clearCookie('accessToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });
  res.clearCookie('refreshToken', { httpOnly: true, secure: isProduction, sameSite: 'strict' });

  res.json({ message: AuthMessages.LOGGED_OUT_SUCCESSFULLY });
});

// ── Email verification ─────────────────────────────────────────────────────────

AuthRouter.post('/email-verification/send', async (req: Request, res: Response) => {
  const user = req.user!;
  await AuthService.sendEmailVerification(user.userId);
  res.json({ message: AuthMessages.EMAIL_VERIFICATION_SENT });
});

AuthRouter.post('/email-verification/verify', async (req: Request, res: Response) => {
  const parsed = VerifyEmailDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthService.verifyEmail(parsed.data.token, parsed.data.userId);

  res.json({ message: AuthMessages.EMAIL_VERIFIED });
});

// ── OTP routes ─────────────────────────────────────────────────────────────────

AuthRouter.post('/otp/send', async (req: Request, res: Response) => {
  const parsed = OTPSendDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthOTPService.sendOTP(req.user!.userId, parsed.data.method);
  res.json({ message: AuthMessages.OTP_SENT });
});

AuthRouter.post('/otp/verify', async (req: Request, res: Response) => {
  const parsed = OTPVerifyDTO.safeParse(req.body);

  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0].message, 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthOTPService.verifyOTP(req.user!.userId, parsed.data.otp, parsed.data.method);
  res.json({ message: AuthMessages.OTP_VERIFIED });
});

// ── TOTP routes ────────────────────────────────────────────────────────────────

AuthRouter.post('/totp/setup', async (req: Request, res: Response) => {
  const { secret, qrCodeUrl } = await AuthTOTPService.setupTOTP(req.user!.userId);
  res.json({ message: AuthMessages.TOTP_SETUP_INITIATED, secret, qrCodeUrl });
});

AuthRouter.post('/totp/enable', async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };

  if (!token) {
    throw new AppError('token is required', 400, ErrorCode.VALIDATION_ERROR);
  }

  const backupCodes = await AuthTOTPService.enableTOTP(req.user!.userId, token);
  res.json({ message: AuthMessages.TOTP_ENABLED, backupCodes });
});

AuthRouter.post('/totp/disable', async (req: Request, res: Response) => {
  const { token, secret } = req.body as { token?: string; secret?: string };

  if (!token || !secret) {
    throw new AppError('token and secret are required', 400, ErrorCode.VALIDATION_ERROR);
  }

  await AuthTOTPService.disableTOTP(req.user!.userId, token, secret);
  res.json({ message: AuthMessages.TOTP_DISABLED });
});

// ── Session sub-router ─────────────────────────────────────────────────────────

AuthRouter.use('/session', Limiter.useAuthLimiter, UserSessionRouter);

export default AuthRouter;
