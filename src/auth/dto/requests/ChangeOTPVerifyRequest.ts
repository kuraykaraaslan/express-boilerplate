import { z } from "zod";

export const ChangeOTPVerifyRequest = z.object({
    otpEnabled: z.boolean(),
    otpStatusChangeToken: z.string().length(6),
});
export type ChangeOTPVerifyRequest = z.infer<typeof ChangeOTPVerifyRequest>;