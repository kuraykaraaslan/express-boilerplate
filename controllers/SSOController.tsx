import {  Request, Response } from "express";

import AuthService from "../services/AuthService";
import GetSSOLinkRequest from "../dtos/requests/sso/GetSSOLinkRequest";
import SSOService from "../services/SSOService";
import GetSessionRequest from "../dtos/requests/auth/GetSessionRequest";
import LoginResponse from "../dtos/responses/auth/LoginResponse";
import MailService from "../services/MailService";

 
export default class SSOController {

    static APP_URL = process.env.APPLICATION_HOST + ":" + process.env.APPLICATION_PORT;
    static ALLOWED_PROVIDERS = ["apple", "facebook", "github", "google", "linkedin", "microsoft", "twitter", "tiktok"];

    // Constants
    static INVALID_PROVIDER = "INVALID_PROVIDER";
    static AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED";
    static OAUTH_ERROR = "OAUTH_ERROR";

    // Frontend URL
    static FRONTEND_URL = process.env.FRONTEND_HOST + ":" + process.env.FRONTEND_PORT;
    static FRONTEND_CALLBACK_PATH = "/auth/sso";
 
    public static async authProvider(request: Request<GetSSOLinkRequest>, response: Response<String>): Promise<void> {

        const provider = request.params.provider! as string;

        if (!this.ALLOWED_PROVIDERS.includes(provider)) {
            throw new Error(this.INVALID_PROVIDER);
        }

        const url = await SSOService.generateAuthUrl(provider);

        return response.redirect(url);
    }

    public static async authCallback(request: Request<GetSSOLinkRequest>, response: Response<any>): Promise<void> {

        const provider = request.params.provider! as string;

        if (!this.ALLOWED_PROVIDERS.includes(provider)) {
            throw new Error("INVALID_PROVIDER");
        }

        var { code, state } = request.query;

        //if code and state are not present, then try to get it from the body
        if (!code) {
            code = request.body.code;
            state = request.body.state;
        }

        if (!code) {
            //redirect to frontend
            throw new Error(this.AUTHENTICATION_FAILED);
        }

        const user = await SSOService.authCallback(provider, code as string, state as string);

        if (!user) {
            //redirect to frontend
            throw new Error(this.AUTHENTICATION_FAILED);
        }

        const userSession = await AuthService.createSession(user, request);

        MailService.sendWelcomeEmail(user);

        if (!userSession) {
            //redirect to frontend
            throw new Error(this.OAUTH_ERROR);
        }

        //redirect to frontend
        return response.redirect(`${this.FRONTEND_URL}${this.FRONTEND_CALLBACK_PATH}?token=${userSession.sessionToken}`);

    }

    public static async getSession(request: Request<GetSessionRequest>, response: Response<LoginResponse>): Promise<Response<LoginResponse>> {
        return response.json(await AuthService.getSession(request.body));
    }
    
}

