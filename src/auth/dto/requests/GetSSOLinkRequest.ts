import { z } from "zod";
export const GetSSOLinkRequest = z.object({
    provider: z.string().min(1),
});
export type GetSSOLinkRequest = z.infer<typeof GetSSOLinkRequest>;