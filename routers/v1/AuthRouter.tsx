/**
 * Auth Router
 * 
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import AuthService from '../../services/AuthService';
import { Router, Request, Response } from "express";

// DTOs
import AuthLoginRequest from '../../dtos/requests/AuthRegisterRequest';
import AuthRegisterRequest from '../../dtos/requests/AuthRegisterRequest';
import UserSessionResponse from '../../dtos/responses/UserSessionResponse';
import GetSessionRequest from '../../dtos/requests/GetSessionRequest';


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
AuthRouter.post('/register', async (req: Request<AuthRegisterRequest>, res: Response<UserSessionResponse>) => {
    const user = await AuthService.register(req.body);
    res.json(user);
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
AuthRouter.post('/login', async (req: Request<AuthLoginRequest>, res: Response<UserSessionResponse>) => {
    const user = await AuthService.authenticate(req.body);
    res.json(user);
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
AuthRouter.post('/logout', async (req: Request<GetSessionRequest>, res: Response) => {
    await AuthService.logout(req.body.token);
    res.sendStatus(200);
});

/**
 * POST /session
 * Get the current user session.
 * 
 * Request Body:
 * - token (string): The session token of the user (required).
 * 
 * Response:
 * - 200: Session details of the user.
 * - 401: Unauthorized if user is not logged in.
 */
AuthRouter.post('/session', async (req: Request<GetSessionRequest>, res: Response<any>) => {
    const session = await AuthService.getSession(req.body.token);
    res.json(session);
});

export default AuthRouter;
