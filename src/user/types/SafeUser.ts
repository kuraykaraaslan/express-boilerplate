import { OTPMethod } from "@prisma/client";
import { z } from "zod";

export const SafeUser = z.object({
    userId: z.string(),
    email: z.string().email(),
    phone: z.string().optional().nullable(),
    name: z.string().optional().nullable(),
    userRole: z.string(),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
    profilePicture: z.string().optional().nullable(),
    otpMethods: z.array(z.nativeEnum(OTPMethod)).optional(),
});

export type SafeUser = z.infer<typeof SafeUser>;