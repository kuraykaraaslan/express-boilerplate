import { z } from "zod";
export const ResetPasswordRequest = z.object({
    email: z.string().email().optional(),
    password: z.string().min(8),
    numericToken: z.string().optional(),
    base64Token: z.string().optional(),
}).refine((data) => {
    // cant have both numericToken and base64Token
    if (data.numericToken && data.base64Token) {
        throw new Error("BOTH_TOKENS_PROVIDED");
    }
    return true;
}
, {
    message: "BOTH_TOKENS_PROVIDED",
});

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequest>;
