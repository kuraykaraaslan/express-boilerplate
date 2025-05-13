import { z } from "zod";

export const UserAgentData = z.object({
    os: z.string().default("Unknown"),
    device: z.string().default("Unknown"),
    city: z.string().nullable().default("Unknown"),
    state: z.string().nullable().default("Unknown"),
    country: z.string().nullable().default("Unknown"),
    ip: z.string().nullable().default("Unknown"),
    browser: z.string().nullable().default("Unknown"),
});

export type UserAgentData = z.infer<typeof UserAgentData>;