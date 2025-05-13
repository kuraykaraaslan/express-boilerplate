import { z } from "zod";
export const ForgotPasswordRequest = z.object({
    email: z.string().email(),
});
export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequest>;