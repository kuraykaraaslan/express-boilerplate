// routers/v1/authRouter/passwordRouter.ts
import { Router, Request, Response } from "express";
import PasswordService from "../services/PasswordService";
import { ForgotPasswordRequest } from "../dto/requests/ForgotPasswordRequest";
import { ResetPasswordRequest } from "../dto/requests/ResetPasswordRequest";
import {MessageResponse} from "@/src/shared/dtos/responses/MessageResponse";

const PasswordRouter = Router();

/**
 * @route POST /auth/forgot-password
 * @desc Sends password reset tokens to user's email and/or phone
 */
PasswordRouter.post(
    "/forgot-password",
    async (request: Request, response: any) => {

        const parsed = ForgotPasswordRequest.safeParse(request.body);

        if (!parsed.success) {
            return response.status(400).json({ message: parsed.error.message });
        }

        await PasswordService.forgotPassword(parsed.data);
        response.json({ message: "Password reset instructions have been sent to your email and/or phone." });
    });

/**
 * @route POST /auth/reset-password
 * @desc Resets user's password using the provided token and method (email/sms)
 */
PasswordRouter.post(
    "/reset-password", async (request: Request, response: Response<MessageResponse>) => {
        const parsed = ResetPasswordRequest.safeParse(request.body);

        if (!parsed.success) {
            throw new Error(parsed.error.issues[0].message);
        }

        await PasswordService.resetPassword(parsed.data);
        response.json({ message: "Password has been reset successfully." });
    });

export default PasswordRouter;
