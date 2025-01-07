import { UserSession } from "@prisma/client";

export default interface OmitOTPFieldsUserSessionResponse extends Omit<UserSession, "otpToken" | "otpTokenExpiry"> {}