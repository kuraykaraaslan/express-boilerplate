/**
 * Auth Router
 * 
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// DTOs
import LoginRequest from '../../../dtos/requests/auth/LoginRequest';
import RegisterRequest from '../../../dtos/requests/auth/RegisterRequest';
import LoginResponse from '../../../dtos/responses/auth/LoginResponse';

// Middlewares
import AuthMiddleware from "../../../middlewares/v1/authMiddleware";

// Utils
import Limiter from "../../../libs/limiter";

// DTOs
import ForgotPasswordRequest from '../../../dtos/requests/auth/ForgotPasswordRequest';
import ResetPasswordRequest from '../../../dtos/requests/auth/ResetPasswordRequest';
import MessageResponse from "../../../dtos/responses/MessageResponse";
import SendOTPRequest from "../../../dtos/requests/auth/SendOTPRequest";
import VerifyOTPRequest from "../../../dtos/requests/auth/VerifyOTPRequest";
import ChangeOTPStatusRequest from "../../../dtos/requests/auth/ChangeOTPStatusRequest";
import ChangeOTPVerifyRequest from "../../../dtos/requests/auth/ChangeOTPVerifyRequest";
import AuthService from "../../../services/v1/AuthService";
import MailService from "../../../services/v1/NotificationService/MailService";

// Mid Router
import tenantAuthRouter from "./tenantAuthRouter";
import UserSessionService from "../../../services/v1/AuthService/UserSessionService";
import UserSessionOTPService from "../../../services/v1/AuthService/UserSessionOTPService";
import PasswordService from "../../../services/v1/AuthService/PasswordService";

import AuthMessages from "../../../dictionaries/AuthMessages";
import PermissionService from "../../../services/v1/PermissionService";
import OTPService from "@/services/v1/AuthService/OTPService";
import { OTPMethod } from "@prisma/client";

// Router
const AuthRouter = Router();

/**
 * GET /login
 * Login page.
 * 
 * Response:
 * - view: auth/login
 * 
 */
AuthRouter.get('/login', async (request: Request, response: Response) => {
    return response.render('auth/login', { message: '' });
});

/**
 * GET /register
 * Register page.
 * 
 * Response:
 * - view: auth/register
 * 
 */
AuthRouter.get('/register', async (request: Request, response: Response) => {
    return response.render('auth/register', { message: '' });
});

/**
 * POST /
 * Create a new user.

 * Request Body:
 * - email (string): The email address of the new user (required).
 * - password (string): The password for the new user (required).
 * 
 * Response:
 * - 201: User successfully created with details of the created user.
 * - 400: Validation error if email or password is missing.
 */
AuthRouter.post('/register', Limiter.useAuthLimiter, async (request: Request<RegisterRequest>, response: Response<MessageResponse>) => {

    const data = new RegisterRequest(request.body);
    const user = await AuthService.register(data);
    response.json({ message: "REGISTER_SUCCESS" });

});

/**
 * POST /
 * Authenticate a user.
 * 
 * Request Body:
 * - email (string): The email address of the user (required).
 * - password (string): The password of the user (required).
 * 
 * Response:
 * - 200: User successfully authenticated with session details.
 * - 400: Validation error if email or password is missing.
 * - 401: Unauthorized if email or password is incorrect.
 */
AuthRouter.post('/login', Limiter.useAuthLimiter, async (request: Request<LoginRequest>, response: Response<LoginResponse>) => {

    const data = new LoginRequest(request.body);
    const user = await AuthService.login(data);
    const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionService.createSession(user, request, false);

    // Set the access token as a cookie
    response.cookie('accessToken', rawAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Set to true in production 
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    });

    // Set the refresh token as a cookie
    response.cookie('refreshToken', rawRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Set to true in production
        sameSite: 'strict',
        path: '/api/v1/auth/session/refresh',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    });

    await MailService.sendNewLoginEmail(user, userSession);

    response.json({
        user,
        accessToken: rawAccessToken,
        refreshToken: rawRefreshToken,
    });

});


AuthRouter.post('/session/otp-send/:method', Limiter.useAuthLimiter, async (request: Request, response: Response) => {
    const user = request.user!;
    const session = request.userSession!;
    const method = request.params.method.toUpperCase();

    const allowedMethods: OTPMethod[] = ['EMAIL', 'SMS', 'TOTP_APP', 'PUSH_APP'];
    if (!allowedMethods.includes(method as OTPMethod)) {
        throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400);
    }

    await UserSessionOTPService.sendOTP({ user, userSession: session, method: method as OTPMethod });

    response.json({ message: AuthMessages.OTP_SENT_SUCCESSFULLY });
});

AuthRouter.post('/session/otp-verify/:method', Limiter.useAuthLimiter, async (request: Request, response: Response) => {
    
    const user = request.user!;
    const session = request.userSession!;
    const method = request.params.method.toUpperCase();

    const allowedMethods: OTPMethod[] = ['EMAIL', 'SMS', 'TOTP_APP', 'PUSH_APP'];
    if (!allowedMethods.includes(method as OTPMethod)) {
        throw new AppError(AuthMessages.INVALID_OTP_METHOD, 400);
    }

    const data = new VerifyOTPRequest(request.body);

    await UserSessionOTPService.validateOTP({ user, userSession: session, otpToken: data.otpToken , method: method as OTPMethod});

    response.json({ message: AuthMessages.OTP_VERIFIED_SUCCESSFULLY });
});



/*
 * POST /session/refresh
 * Refresh the user session.
 *
 * Request Body:
 * - refreshToken (string): The refresh token of the user (required).
 *
 * Response:
 * - 200: User session refreshed successfully with new access and refresh tokens.   
 * - 401: Unauthorized if refresh token is invalid.
 * - 500: Internal server error if session refresh fails.
 */
AuthRouter.post('/session/refresh', async (request: Request, response: Response<LoginResponse>) => {
    const { refreshToken } = request.body;
    console.log("refreshToken", refreshToken);
    const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionService.refreshAccessToken(refreshToken);

    // Set the new access token as a cookie
    response.cookie('accessToken', rawAccessToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Set to true in production
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    });
    // Set the new refresh token as a cookie
    response.cookie('refreshToken', rawRefreshToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Set to true in production
        sameSite: 'strict',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    });


    response.json({
        accessToken: rawAccessToken,
        refreshToken: rawRefreshToken,
    });
});



/**
 * POST /forgot-password
 * Send a password reset email to the user.
 * 
 * Request Body:
 * - email (string): The email address of the user (required).
 * 
 * Response:
 * - 200: Password reset email sent successfully.
 * - 400: Validation error if email is missing.
 * - 404: User not found if email does not exist in the database.
 */
AuthRouter.post('/forgot-password', Limiter.useAuthLimiter, async (request: Request<ForgotPasswordRequest>, response: Response<MessageResponse>) => {

    const data = new ForgotPasswordRequest(request.body);
    await PasswordService.forgotPassword(data);

    response.json({ message: AuthMessages.FORGOT_PASSWORD_SUCCESSFUL });

});

/**
 * POST /reset-password
 * Reset the password of the user.
 * 
 * Request Body:
 * - accessToken (string): The password reset token sent to the user's email (required).
 * - password (string): The new password for the user (required).
 * 
 * Response:
 * - 200: Password successfully reset.
 * - 400: Validation error if token or password is missing.
 * - 404: User not found if token is invalid.
 */
AuthRouter.post('/reset-password', Limiter.useAuthLimiter, async (request: Request<ResetPasswordRequest>, response: Response<MessageResponse>) => {

    const data = new ResetPasswordRequest(request.body);
    await PasswordService.resetPassword(data);

    response.json({ message: AuthMessages.PASSWORD_RESET_SUCCESSFUL });

});



// All routes below this point require the user to be logged in

AuthRouter.use(AuthMiddleware("USER"));



/**
 * GET /session
 * Get the current user session.
 *
 * Response:
 * - 200: User session details.
 * - 401: Unauthorized if user is not logged in.
 */
AuthRouter.get('/session', Limiter.useAuthLimiter, async (request: Request, response: Response<LoginResponse>) => {

    response.json({
        user: request.user!
    });
});


/**
 * POST /logout
 * Logout the current user.
 * 
 * Response:
 * - 200: User successfully logged out.
 * - 401: Unauthorized if user is not logged in.
 * - 500: Internal server error if logout fails.
 */
AuthRouter.post('/logout', async (request: Request, response: Response<MessageResponse>) => {

    // Clear the cookies
    response.clearCookie('accessToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Set to true in production
        sameSite: 'strict',
        maxAge: 0,
    });
    response.clearCookie('refreshToken', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production', // Set to true in production
        sameSite: 'strict',
        maxAge: 0,
    });
    // Destroy the session
    await UserSessionService.deleteSession(request.userSession!);

    response.json({ message: AuthMessages.LOGGED_OUT_SUCCESSFULLY });
});


/**
 * POST /session/tenant
 * Tenant Auth Router
 *
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
AuthRouter.use('/session/tenant', tenantAuthRouter);




/**
 * POST /settings/destroy-other-sessions
 * Destroy all other sessions of the user.
 *
 * Response:
 * - 200: All other sessions destroyed successfully.
 * - 500: Internal server error if session destruction fails.
 * - 401: Unauthorized if user is not logged in.
 */
AuthRouter.post('/session/destroy-other-sessions', async (request: Request, response: Response<MessageResponse>) => {
    await UserSessionService.destroyOtherSessions(request.userSession!);
    response.json({ message: AuthMessages.OTHER_SESSIONS_DESTROYED });
});



export default AuthRouter;