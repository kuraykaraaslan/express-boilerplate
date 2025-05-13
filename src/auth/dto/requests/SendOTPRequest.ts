import { z } from "zod";
export const SendOTPRequest = z.object({
   method: z.enum(["email", "sms", "push_app", "totp_app", "whatsapp"]),
}).refine((data) => {
   return true;
});

export type SendOTPRequest = z.infer<typeof SendOTPRequest>;