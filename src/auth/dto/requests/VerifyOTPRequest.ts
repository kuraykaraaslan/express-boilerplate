import { z } from "zod";
export const VerifyOTPRequest = z.object({
   otpToken: z.string().min(1),
   method: z.enum(["email", "sms", "push_app", "totp_app", "whatsapp"]),
}).refine((data) => {
   return true;
}
, {
   message: "INVALID_OTP_TOKEN",
});
export type VerifyOTPRequest = z.infer<typeof VerifyOTPRequest>;