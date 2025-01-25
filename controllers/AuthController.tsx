import { NextFunction, Request, Response } from "express";

import LoginResponse from "../dtos/responses/auth/LoginResponse";
import AuthService from "../services/AuthService";
import FieldValidater from "../utils/FieldValidater";
import MessageResponse from "../dtos/responses/MessageResponse";
import LoginRequest from "../dtos/requests/auth/LoginRequest";
import ForgotPasswordRequest from "../dtos/requests/auth/ForgotPasswordRequest";
import ResetPasswordRequest from "../dtos/requests/auth/ResetPasswordRequest";
import GetSessionRequest from "../dtos/requests/auth/GetSessionRequest";
import VerifyOTPRequest from "../dtos/requests/auth/VerifyOTPRequest";
import ChangeOTPStatusRequest from "../dtos/requests/auth/ChangeOTPStatusRequest";
import ChangeOTPVerifyRequest from "../dtos/requests/auth/ChangeOTPVerifyRequest";
import EmptyRequest from "../dtos/requests/EmptyRequest";
import RegisterRequest from "../dtos/requests/auth/RegisterRequest";
import MailService from "../services/MailService";


export default class AuthController {

    public static async login(request: Request<LoginRequest>, response: Response<LoginResponse>): Promise<Response<LoginResponse>> {

        const { email, password } = request.body;

        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD");
        }

        const user = await AuthService.login({ email, password });

        const userSession = await AuthService.createSession(user, request, true);

        MailService.sendNewLoginEmail(user, userSession);

        return response.json({ user, userSession });   


    }

    public static async register(request: Request<RegisterRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {

        const { email, password } = request.body;

        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD");
        }

        return response.json(await AuthService.register({ email, password }));
    }

    public static async forgotPassword(request: Request<ForgotPasswordRequest>, response: Response): Promise<Response<MessageResponse>> {

        const { email } = request.body;

        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        await AuthService.forgotPassword({ email });

        return response.json({ message: "FORGOT_PASSWORD_SUCCESS" });
    }

    public static async resetPassword(request: Request<ResetPasswordRequest>, response: Response): Promise<Response<MessageResponse>> {

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


    public static async getSession(request: Request<EmptyRequest>, response: Response<LoginResponse>): Promise<Response<LoginResponse>> {

        return response.json({ user: request.user!, userSession: request.userSession! });
    }

    public static async otpVerify(request: Request<VerifyOTPRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {

        const { sessionToken, otpToken } = request.body;

        if (!FieldValidater.isSessionToken(sessionToken)) {
            throw new Error("INVALID_TOKEN");
        }

        if (!FieldValidater.isVerificationToken(otpToken)) {
            throw new Error("INVALID_CODE");
        }

        return response.json(await AuthService.otpVerify(sessionToken, otpToken));
    }

    public static async otpSend(request: Request<GetSessionRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {

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

    public static async otpChangeStatus(request: Request<ChangeOTPStatusRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {
        
        const { otpEnabled } = request.body;

        if (otpEnabled === undefined || typeof otpEnabled !== "boolean") {
            throw new Error("INVALID_OTP_STATUS");
        }

        return response.json(await AuthService.otpChangeStatus(request.user!, otpEnabled));
    }

    public static async otpChangeVerify(request: Request<ChangeOTPVerifyRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {
        
        const { otpEnabled, otpStatusChangeToken } = request.body;

        if (otpEnabled === undefined || typeof otpEnabled !== "boolean") {
            throw new Error("INVALID_OTP_STATUS");
        }

        if (!FieldValidater.isVerificationToken(otpStatusChangeToken)) {
            throw new Error("INVALID_CODE");
        }

        return response.json(await AuthService.otpChangeVerify(request.user!, otpEnabled, otpStatusChangeToken));
    }


}
