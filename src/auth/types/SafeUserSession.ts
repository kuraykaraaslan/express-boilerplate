import { z } from "zod";

export const SafeUserSession = z.object({
    userSessionId: z.string(),
    userId: z.string(),
    otpVerifyNeeded: z.boolean(),
    sessionExpiry: z.date(),
});

export type SafeUserSession = z.infer<typeof SafeUserSession>;