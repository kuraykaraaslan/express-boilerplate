// routers/v1/authRouter/passwordRouter.ts
import { Router, Request, Response } from "express";
import PasswordService from "../../../services/v1/AuthService/PasswordService";
import ForgotPasswordRequest from "../../../dtos/requests/auth/ForgotPasswordRequest";
import ResetPasswordRequest from "../../../dtos/requests/auth/ResetPasswordRequest";
import MessageResponse from "../../../dtos/responses/MessageResponse";

const PasswordRouter = Router();

/**
 * @route POST /auth/forgot-password
 * @desc Sends password reset tokens to user's email and/or phone
 */
PasswordRouter.post(
    "/forgot-password",
    async (request: Request, response: Response) => {

        const data = new ForgotPasswordRequest(request.body);
        const { email } = data;

        await PasswordService.forgotPassword(data);
        response.json({ message: "Password reset instructions have been sent to your email and/or phone." });
    });

/**
 * @route POST /auth/reset-password
 * @desc Resets user's password using the provided token and method (email/sms)
 */
PasswordRouter.post(
    "/reset-password", async (request: Request, response: Response) => {
        const data = new ResetPasswordRequest(request.body);
        await PasswordService.resetPassword(data);
        response.json({ message: "Password has been reset successfully." });
    });

export default PasswordRouter;
