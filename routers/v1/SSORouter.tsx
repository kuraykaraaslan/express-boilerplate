/**
 * SocialAccountRouter.tsx
 * 
 * This module provides endpoints to manage user social account operations such as adding, updating, and deleting social accounts.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";
import SSOController from "../../controllers/SSOController";
import FieldValidater from "../../utils/FieldValidater";

// DTOs
import GetSSOLinkRequest from "../../dtos/requests/sso/GetSSOLinkRequest";
import LoginResponse from "../../dtos/responses/auth/LoginResponse";
import EmptyRequest from "../../dtos/requests/EmptyRequest";
import GetSessionRequest from "../../dtos/requests/auth/GetSessionRequest";




const ssoRouter = Router();

/**
 * POST /sso
 * Get User and User Session
 * 
 */
ssoRouter.post('/', async (request: Request<GetSessionRequest>, response: Response<LoginResponse>) => {


    console.log(request.body);
    
    if (!FieldValidater.validateBody(request.body, GetSessionRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await SSOController.getSession(request, response);
});

/**
 * GET /sso/:provider
 * SSO page.
 * 
 * Redirects to the SSO provider's login page.
 * 
 */
ssoRouter.get('/:provider', async (request: Request<GetSSOLinkRequest>, response: Response) => {

    if (!FieldValidater.validateBody(request.body, EmptyRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await SSOController.authProvider(request, response);
});

/**
 * GET /callback/:provider
 * Create a new user or authenticate an existing user using the SSO provider.
 */
ssoRouter.get('/callback/:provider', async (request: Request<any>, response: Response<LoginResponse>) => {

    if (!FieldValidater.validateBody(request.body, EmptyRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await SSOController.authCallback(request, response);
});

export default ssoRouter;