import { z } from "zod";

export const CreateUserRequest= z.object({
    email: z.string().email(),
    password: z.string().min(8).max(32),
    name: z.string().optional(),
}).strict();
export type CreateUserRequest = z.infer<typeof CreateUserRequest>;