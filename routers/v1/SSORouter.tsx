/**
 * SocialAccountRouter.tsx
 * 
 * This module provides endpoints to manage user social account operations such as adding, updating, and deleting social accounts.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response, response } from "express";
import SSOController from "../../controllers/SSOController";
import FieldValidater from "../../utils/FieldValidater";

// DTOs
import SSOProviderRequest from "../../dtos/requests/SSOProviderRequest";
import AuthResponse from "../../dtos/responses/AuthResponse";
import EmptyRequest from "../../dtos/requests/EmptyRequest";
import AuthGetSessionRequest from "../../dtos/requests/AuthGetSessionRequest";




const ssoRouter = Router();

/**
 * POST /sso
 * Get User and User Session
 * 
 */
ssoRouter.post('/', async (request: Request<AuthGetSessionRequest>, response: Response<AuthResponse>) => {


    console.log(request.body);
    
    if (!FieldValidater.validateBody(request.body, AuthGetSessionRequest)) {
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
ssoRouter.get('/:provider', async (request: Request<SSOProviderRequest>, response: Response) => {

    if (!FieldValidater.validateBody(request.body, EmptyRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await SSOController.authProvider(request, response);
});

/**
 * GET /callback/:provider
 * Create a new user or authenticate an existing user using the SSO provider.
 */
ssoRouter.get('/callback/:provider', async (request: Request<any>, response: Response<AuthResponse>) => {

    if (!FieldValidater.validateBody(request.body, EmptyRequest)) {
        throw new Error("BAD_REQUEST");
    }

    return await SSOController.authCallback(request, response);
});

export default ssoRouter;