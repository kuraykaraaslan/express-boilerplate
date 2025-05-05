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
import MessageResponse from "../../../dtos/responses/MessageResponse";
import AuthService from "../../../services/v1/AuthService";
import MailService from "../../../services/v1/NotificationService/MailService";

// Mid Router
import UserSessionService from "../../../services/v1/AuthService/UserSessionService";

import AuthMessages from "../../../dictionaries/AuthMessages";
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






export default AuthRouter;