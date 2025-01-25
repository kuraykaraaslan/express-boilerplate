/**
 * Auth Router
 * 
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// DTOs
import LoginRequest from '../../dtos/requests/auth/LoginRequest';
import RegisterRequest from '../../dtos/requests/auth/RegisterRequest';
import LoginResponse from '../../dtos/responses/auth/LoginResponse';

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";
import ForgotPasswordRequest from '../../dtos/requests/auth/ForgotPasswordRequest';
import ResetPasswordRequest from '../../dtos/requests/auth/ResetPasswordRequest';
import AuthController from '../../controllers/AuthController';
import MessageResponse from "../../dtos/responses/MessageResponse";
import SendOTPRequest from "../../dtos/requests/auth/SendOTPRequest";
import VerifyOTPRequest from "../../dtos/requests/auth/VerifyOTPRequest";
import ChangeOTPStatusRequest from "../../dtos/requests/auth/ChangeOTPStatusRequest";
import ChangeOTPVerifyRequest from "../../dtos/requests/auth/ChangeOTPVerifyRequest";
import EmptyRequest from "../../dtos/requests/EmptyRequest";


// Validators
import FieldValidater from "../../utils/FieldValidater";
import Limiter from "../../libs/limiter";

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

    if (!FieldValidater.validateBody(request.body, RegisterRequest)) {
        throw new Error("BAD_REQUEST");
    }

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
AuthRouter.post('/login', Limiter.useAuthLimiter, async (request: Request<LoginRequest>, response: Response<LoginResponse>) => {

    if (!FieldValidater.validateBody(request.body, LoginRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.login(request, response);
});



/**
 * POST /session/otp-verify
 * Verify the OTP of the user.
 * 
 * Request Body:
 * - token (string): The session token of the user (required).
 * - otp (string): The OTP of the user (required).
 * 
 */
AuthRouter.post('/session/otp-verify', Limiter.useAuthLimiter, async (request: Request<VerifyOTPRequest>, response: Response<MessageResponse>) => {

    if (!FieldValidater.validateBody(request.body, VerifyOTPRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.otpVerify(request, response);
});

/**
 * POST /session/otp-send
 * Send the OTP to the user's phone number.
 * 
 * Request Body:
 * - sessionToken (string): The session sessionToken of the user (required).
 * - method (string): The method to send the OTP (sms or email) (required).
 * 
 * Response:
 * - 200: OTP sent successfully.
 * - 400: Validation error if sessionToken is missing.
 * - 404: User not found if sessionToken is invalid.
 * - 500: Internal server error if OTP sending fails.
 */
AuthRouter.post('/session/otp-send', Limiter.useAuthLimiter, async (request: Request<SendOTPRequest>, response: Response<MessageResponse>) => {

    if (!FieldValidater.validateBody(request.body, SendOTPRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.otpSend(request, response);
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

    if (!FieldValidater.validateBody(request.body, ForgotPasswordRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.forgotPassword(request, response);
});

/**
 * POST /reset-password
 * Reset the password of the user.
 * 
 * Request Body:
 * - sessionToken (string): The password reset token sent to the user's email (required).
 * - password (string): The new password for the user (required).
 * 
 * Response:
 * - 200: Password successfully reset.
 * - 400: Validation error if token or password is missing.
 * - 404: User not found if token is invalid.
 */
AuthRouter.post('/reset-password', Limiter.useAuthLimiter, async (request: Request<ResetPasswordRequest>, response: Response<MessageResponse>) => {

    if (!FieldValidater.validateBody(request.body, ResetPasswordRequest)) {
        throw new Error("BAD_REQUEST");
    }

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
AuthRouter.post('/logout', async (request: Request<EmptyRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> => {

    if (!FieldValidater.validateBody(request.body, EmptyRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.logout(request, response);
});

/**
 * GET /session
 * Get the current user session.
 * 
 * Request Body:
 * - sessionToken (string): The session token of the user (required).
 * 
 * Response:
 * - 200: Session details of the user.
 * - 401: Unauthorized if user is not logged in.
 */
AuthRouter.get('/session', async (request: Request<EmptyRequest>, response: Response<LoginResponse>) => {

    if (!FieldValidater.validateBody(request.body, EmptyRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.getSession(request, response);
});

/**
 * POST /settings/otp
 * Send the OTP Enable to user.
 * 
 * Request Body:
 * - otpEnabled (boolean): The OTP Enable of the user (required).
 * 
 * Response:
 * - 200: OTP Enable message sent successfully.
 * - 500: OTP Already Enabled.
 */
AuthRouter.post('/settings/otp-change', async (request: Request<ChangeOTPStatusRequest>, response: Response<MessageResponse>) => {

    if (!FieldValidater.validateBody(request.body, ChangeOTPStatusRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.otpChangeStatus(request, response);
});


/**
 * POST /settings/otp
 * Change the OTP Enable of the user.
 * 
 * Request Body:
 * - otpEnabled (boolean): The OTP Enable of the user (required).
 * - otpStatusChangeToken(string): The OTP Enable of the user (required).
 *
 * Response:
 * - 200: OTP Enable message sent successfully.
 * - 500: OTP Already Enabled.
 * - 401: Unauthorized if user is not logged in.
 */
AuthRouter.post('/settings/otp-verify', async (request: Request<ChangeOTPVerifyRequest>, response: Response<MessageResponse>) => {

    if (!FieldValidater.validateBody(request.body, ChangeOTPVerifyRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await AuthController.otpChangeVerify(request, response);
});

export default AuthRouter;