import { z } from "zod";
export const GetSessionRequest = z.object({
   accessToken: z.string().min(1),
});

export type GetSessionRequest = z.infer<typeof GetSessionRequest>;