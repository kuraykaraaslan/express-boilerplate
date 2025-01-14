/**
 * Auth Router
 * 
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response, response } from "express";

// DTOs
import AuthLoginRequest from '../../dtos/requests/AuthRegisterRequest';
import AuthRegisterRequest from '../../dtos/requests/AuthRegisterRequest';
import UserSessionResponse from '../../dtos/responses/UserSessionResponse';
import GetSessionRequest from '../../dtos/requests/GetSessionRequest';

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";
import AuthForgotPasswordRequest from '../../dtos/requests/AuthForgotPasswordRequest';
import AuthResetPasswordRequest from '../../dtos/requests/AuthResetPasswordRequest';
import AuthController from '../../controllers/AuthController';
import MessageResponse from "../../dtos/responses/MessageResponse";


const AuthRouter = Router();

/**
 * POST /
 * Create a new user.
 * 
 * Request Body:
 * - email (string): The email address of the new user (required).
 * - password (string): The password for the new user (required).
 * 
 * Response:
 * - 201: User successfully created with details of the created user.
 * - 400: Validation error if email or password is missing.
 */
AuthRouter.post('/register', async (request: Request<AuthRegisterRequest>, response: Response<UserSessionResponse>) => {
    return await AuthController.register(request, response);
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
AuthRouter.post('/login', async (request: Request<AuthLoginRequest>, response: Response<UserSessionResponse>) => {
    return await AuthController.login(request, response);
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
AuthRouter.post('/forgot-password', async (request: Request<AuthForgotPasswordRequest>, response: Response<MessageResponse>) => {
    return await AuthController.forgotPassword(request, response);
});

/**
 * POST /reset-password
 * Reset the password of the user.
 * 
 * Request Body:
 * - token (string): The password reset token sent to the user's email (required).
 * - password (string): The new password for the user (required).
 * 
 * Response:
 * - 200: Password successfully reset.
 * - 400: Validation error if token or password is missing.
 * - 404: User not found if token is invalid.
 */
AuthRouter.post('/reset-password', async (request: Request<AuthResetPasswordRequest>, response: Response<MessageResponse>) => {
    return await AuthController.resetPassword(request, response);
});



// All routes below this point require the user to be logged in

AuthRouter.use(AuthMiddleware("USER"));

/**
 * POST /logout
 * Logout the current user.
 * 
 * Response:
 * - 200: User successfully logged out.
 * - 401: Unauthorized if user is not logged in.
 * - 500: Internal server error if logout fails.
 */
AuthRouter.post('/logout', async (request: Request<GetSessionRequest>, response: Response<MessageResponse>) => {
    return await AuthController.logout(request, response);
});

/**
 * GET /session
 * Get the current user session.
 * 
 * Request Body:
 * - token (string): The session token of the user (required).
 * 
 * Response:
 * - 200: Session details of the user.
 * - 401: Unauthorized if user is not logged in.
 */
AuthRouter.get('/session', async (request: Request<GetSessionRequest>, response: Response<any>) => {
    return await AuthController.getSession(request, response);
});


export default AuthRouter;
