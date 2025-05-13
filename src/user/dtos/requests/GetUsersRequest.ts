import { z } from "zod";
export const GetUsersRequest = z.object({
    skip: z.number().optional().default(0),
    take: z.number().optional().default(10),
    userId: z.string().cuid().optional(),
    search: z.string().optional(),
}).strict();
export type GetUsersRequest = z.infer<typeof GetUsersRequest>;