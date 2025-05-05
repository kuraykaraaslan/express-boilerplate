/**
 * User Session Router
 * 
 * This module provides endpoints to manage user session 
 * authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// DTOs
import LoginResponse from '../../../dtos/responses/auth/LoginResponse';

// Utils
import Limiter from "../../../libs/limiter";

// DTOs
import VerifyOTPRequest from "../../../dtos/requests/auth/VerifyOTPRequest";

// Mid Router
import UserSessionService from "../../../services/v1/AuthService/UserSessionService";
import UserSessionOTPService from "../../../services/v1/AuthService/UserSessionOTPService";

import AuthMessages from "../../../dictionaries/AuthMessages";
import { OTPMethod } from "@prisma/client";
import MessageResponse from "../../../dtos/responses/MessageResponse";
import tenantUserSessionRouter from "./tenantUserSessionRouter";


// Router
const UserSessionRouter = Router();



/**
 * GET /session
 * Get the current user session.
 *
 * Response:
 * - 200: User session details.
 * - 401: Unauthorized if user is not logged in.
 */
UserSessionRouter.get('/', Limiter.useAuthLimiter, async (request: Request, response: Response<LoginResponse>) => {

    response.json({
        user: request.user!
    });
});


UserSessionRouter.post('/otp-send/:method', Limiter.useAuthLimiter, async (request: Request, response: Response) => {
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

UserSessionRouter.post('/otp-verify/:method', Limiter.useAuthLimiter, async (request: Request, response: Response) => {
    
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
UserSessionRouter.post('/refresh', async (request: Request, response: Response<LoginResponse>) => {
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
* POST /settings/destroy-other-sessions
* Destroy all other sessions of the user.
*
* Response:
* - 200: All other sessions destroyed successfully.
* - 500: Internal server error if session destruction fails.
* - 401: Unauthorized if user is not logged in.
*/
UserSessionRouter.post('/session/destroy-other-sessions', async (request: Request, response: Response<MessageResponse>) => {
   await UserSessionService.destroyOtherSessions(request.userSession!);
   response.json({ message: AuthMessages.OTHER_SESSIONS_DESTROYED });
});

UserSessionRouter.use("/tenant", tenantUserSessionRouter);

export default UserSessionRouter;