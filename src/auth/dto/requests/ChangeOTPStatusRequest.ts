import { z } from "zod";

export const ChangeOTPStatusRequest = z.object({
    otpEnabled: z.boolean(),
});

export type ChangeOTPStatusRequest = z.infer<typeof ChangeOTPStatusRequest>;