/**
 * Auth Router
 * 
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// DTOs
import { LoginRequest } from '../dto/requests/LoginRequest';
import { RegisterRequest } from '../dto/requests/RegisterRequest';
import { AuthResponse } from '../dto/responses/AuthResponse';

// Middlewares
import AuthMiddleware from "../middleware";

// Utils
import Limiter from "../../shared/libs/limiter";

// DTOs
import AuthService from "../services";
import MailService from "../../mail/services";

// Mid Router
import UserSessionService from "../services/UserSessionService";

import AuthMessages from "../dictionaries";
import UserSessionRouter from "./userSessionRouter";
import PasswordRouter from "./passwordRouter";

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
AuthRouter.get('/login', async (request: Request, response: any) => {
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
AuthRouter.get('/register', async (request: Request, response: any) => {
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
AuthRouter.post('/register', Limiter.useAuthLimiter, async (request: Request, response: any) => {
    const parsed = RegisterRequest.safeParse(request.body);

    if (!parsed.success) {
        throw new Error(parsed.error.issues[0].message);
    }

    await AuthService.register(parsed.data);

    return response.status(201).json({
        message: AuthMessages.REGISTRATION_SUCCESSFUL
    });

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
AuthRouter.post('/login', Limiter.useAuthLimiter, async (request: Request, response: any) => {

    const parsed = LoginRequest.safeParse(request.body);

    if (!parsed.success) {
        throw new Error(parsed.error.issues[0].message);
    }

    const user = await AuthService.login(parsed.data);
    
    const { userSession, rawAccessToken, rawRefreshToken } = await UserSessionService.createSession(user, request as any, false);

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
        //path: '/api/v1/auth/session/refresh',
        maxAge: 1000 * 60 * 60 * 24 * 7, // 1 week
    });

    await MailService.sendNewLoginEmail(user, userSession);

    response.json({
        user,
        accessToken: rawAccessToken,
        refreshToken: rawRefreshToken,
    });

});


/**
 * USE /password
 * Password management routes.
 *
 * This includes routes for password reset and forgot password functionalities.
 */

AuthRouter.use('/password', Limiter.useAuthLimiter, PasswordRouter);


// All routes below this point require the user to be logged in

AuthRouter.use(AuthMiddleware("USER"));



AuthRouter.use('/session', Limiter.useAuthLimiter, UserSessionRouter);


/**
 * POST /logout
 * Logout the current user.
 * 
 * Response:
 * - 200: User successfully logged out.
 * - 401: Unauthorized if user is not logged in.
 * - 500: Internal server error if logout fails.
 */
AuthRouter.post('/logout', async (request: Request, response: any) => {

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






export default AuthRouter;