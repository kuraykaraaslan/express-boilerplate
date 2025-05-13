import { SafeUser } from "../../types/SafeUser";
import { z } from "zod";
export const GetUsersResponse = z.object({
    users: z.array(SafeUser),
    total: z.number(),
}).strict();
export type GetUsersResponse = z.infer<typeof GetUsersResponse>;