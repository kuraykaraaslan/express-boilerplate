import UserSessionResponse from "@/dtos/responses/UserSessionResponse";
import AuthService from "../services/AuthService";
import FieldValidater from "../utils/FieldValidater";
import MessageResponse from "../dtos/responses/MessageResponse";
import AuthLoginRequest from "../dtos/requests/AuthLoginRequest";
import AuthForgotPasswordRequest from "../dtos/requests/AuthForgotPasswordRequest";
import AuthResetPasswordRequest from "../dtos/requests/AuthResetPasswordRequest";
import AuthGetSessionRequest from "../dtos/requests/AuthGetSessionRequest";
import { Request, Response } from "express";

export default class AuthController {

    public static async login(request: Request<AuthLoginRequest>, response: Response<UserSessionResponse>): Promise<Response<UserSessionResponse>> {

        const { email, password } = request.body;
        
        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD");
        }


        return response.json(await AuthService.login({ email, password }));

    }

    public static async register(request: Request<AuthLoginRequest>, response: Response<UserSessionResponse>): Promise<Response<UserSessionResponse>> {

        const { email, password } = request.body;
        
        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD");
        }

        return response.json(await AuthService.register({ email, password }));
    }

    public static async forgotPassword(request: Request<AuthForgotPasswordRequest>, response: Response): Promise<Response<MessageResponse>> {

        const { email } = request.body;
        
        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        await AuthService.forgotPassword({ email });

        return response.json({ message: "FORGOT_PASSWORD_SUCCESS" });
    }

    public static async resetPassword(request: Request<AuthResetPasswordRequest>, response: Response): Promise<Response<MessageResponse>> {

        const { email, password, resetToken } = request.body;
        
        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD");
        }

        if (!FieldValidater.isVerificationToken(resetToken)) {
            throw new Error("INVALID_CODE");
        }

        await AuthService.resetPassword({ email, password, resetToken });

        return response.json({ message: "PASSWORD_RESET_SUCCESS" });
    }

    public static async logout(request: Request<AuthGetSessionRequest>, response: Response): Promise<Response<MessageResponse>> {

        const { token } = request.body;
        
        if (!FieldValidater.isVerificationToken(token)) {

            throw new Error("INVALID_TOKEN");
        }

        await AuthService.logout({ token });

        return response.json({ message: "LOGOUT_SUCCESS" });
    }


    public static async getSession(request: Request<any>, response: Response<UserSessionResponse>): Promise<Response<UserSessionResponse>> {

        return response.json({ user: request.user! , userSession: request.userSession! });
    }
}
