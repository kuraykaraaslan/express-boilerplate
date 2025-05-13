import { z } from "zod";
export const GetUserRequest = z.object({
    userId: z.string().cuid(),
}).strict();
export type GetUserRequest = z.infer<typeof GetUserRequest>;