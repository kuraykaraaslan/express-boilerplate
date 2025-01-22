import { NextFunction, Request, Response } from "express";

import AuthResponse from "@/dtos/responses/AuthResponse";
import AuthService from "../services/AuthService";
import FieldValidater from "../utils/FieldValidater";
import MessageResponse from "../dtos/responses/MessageResponse";
import AuthLoginRequest from "../dtos/requests/AuthLoginRequest";
import AuthForgotPasswordRequest from "../dtos/requests/AuthForgotPasswordRequest";
import AuthResetPasswordRequest from "../dtos/requests/AuthResetPasswordRequest";
import AuthGetSessionRequest from "../dtos/requests/AuthGetSessionRequest";
import AuthVerifyOTPRequest from "@/dtos/requests/AuthVerifyOTPRequest";
import AuthChangeOTPStatusRequest from "@/dtos/requests/AuthChangeOTPStatusRequest";
import AuthChangeOTPVerifyRequest from "@/dtos/requests/AuthChangeOTPVerifyRequest";
import EmptyRequest from "@/dtos/requests/EmptyRequest";
import AuthGetSSOProviderRequest from "@/dtos/requests/AuthGetSSOProviderRequest";


export default class AuthController {

    public static async login(request: Request<AuthLoginRequest>, response: Response<AuthResponse>): Promise<Response<AuthResponse>> {

        const { email, password } = request.body;

        //write keys
        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD");
        }


        return response.json(await AuthService.login({ email, password }));

    }

    public static async register(request: Request<AuthLoginRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {

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

    public static async logout(request: Request<EmptyRequest>, response: Response): Promise<Response<MessageResponse>> {

        const { sessionToken } = request.userSession!;

        if (!FieldValidater.isSessionToken(sessionToken)) {

            throw new Error("INVALID_TOKEN");
        }

        await AuthService.logout({ sessionToken });
        
        return response.json({ message: "LOGOUT_SUCCESS" });
    }


    public static async getSession(request: Request<EmptyRequest>, response: Response<AuthResponse>): Promise<Response<AuthResponse>> {

        return response.json({ user: request.user!, userSession: request.userSession! });
    }

    public static async otpVerify(request: Request<AuthVerifyOTPRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {

        const { sessionToken, otpToken } = request.body;

        if (!FieldValidater.isSessionToken(sessionToken)) {
            throw new Error("INVALID_TOKEN");
        }

        if (!FieldValidater.isVerificationToken(otpToken)) {
            throw new Error("INVALID_CODE");
        }

        return response.json(await AuthService.otpVerify(sessionToken, otpToken));
    }

    public static async otpSend(request: Request<AuthGetSessionRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {

        const { sessionToken, method } = request.body;

        if (!FieldValidater.isSessionToken(sessionToken)) {
            throw new Error("INVALID_TOKEN");
        }

        const allowedMethods = ["sms", "email"];
        if (!allowedMethods.includes(method)) {
            throw new Error("INVALID_METHOD");
        }


        return response.json(await AuthService.otpSend(sessionToken, method));

    }

    // Services Below has user as a parameter and userSession as a parameter so we can pass the user and userSession from the request object

    public static async otpChangeStatus(request: Request<AuthChangeOTPStatusRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {
        
        const { otpEnabled } = request.body;

        if (otpEnabled === undefined || typeof otpEnabled !== "boolean") {
            throw new Error("INVALID_OTP_STATUS");
        }

        return response.json(await AuthService.otpChangeStatus(request.user!, otpEnabled));
    }

    public static async otpChangeVerify(request: Request<AuthChangeOTPVerifyRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {
        
        const { otpEnabled, otpStatusChangeToken } = request.body;

        if (otpEnabled === undefined || typeof otpEnabled !== "boolean") {
            throw new Error("INVALID_OTP_STATUS");
        }

        if (!FieldValidater.isVerificationToken(otpStatusChangeToken)) {
            throw new Error("INVALID_CODE");
        }

        return response.json(await AuthService.otpChangeVerify(request.user!, otpEnabled, otpStatusChangeToken));
    }

    public static async authProvider(request: Request<AuthGetSSOProviderRequest>, response: Response<String>): Promise<void> {

        const provider = request.params.provider! as string;

        const allowedProviders = ["google", "facebook", "github", "apple"];

        console.log(provider);

        if (!allowedProviders.includes(provider)) {
            throw new Error("INVALID_PROVIDER");
        }

        const url = await AuthService.authProvider(provider);

        return response.redirect(url);
    }

    public static async authCallback(request: Request<AuthGetSSOProviderRequest>, response: Response<any>): Promise<void> {

        const provider = request.params.provider! as string;

        const allowedProviders = ["google", "facebook", "github", "apple"];

        if (!allowedProviders.includes(provider)) {
            throw new Error("INVALID_PROVIDER");
        }

        const { code , state } = request.query;

        const user = await AuthService.authCallback(provider, code as string, state as string);

        response.json({ user });
    }

}
