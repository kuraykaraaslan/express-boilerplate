import { z } from "zod";
export const PutUserRequest = z.object({
    userId: z.string().cuid(),
    email: z.string().email(),
    name: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    role: z.string().optional(),
}).strict();
export type PutUserRequest = z.infer<typeof PutUserRequest>;

