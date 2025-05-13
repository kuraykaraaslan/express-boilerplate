import { z } from "zod";
import { SafeUser } from "../../../../types/SafeUser";
export const AuthResponse = z.object({
    user: SafeUser,
    accessToken: z.string().optional(),
    refreshToken: z.string().optional(),
});
export type AuthResponse = z.infer<typeof AuthResponse>;