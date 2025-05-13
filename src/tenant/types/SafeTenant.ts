import { z } from "zod";
import { TenantStatus } from "@prisma/client";

export const SafeTenant = z.object({
    tenantId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    tenantStatus: z.nativeEnum(TenantStatus),
    domain: z.string(),
    region: z.string(),
    createdAt: z.date().optional(),
    updatedAt: z.date().optional(),
    deletedAt: z.date().optional(),
});
export type SafeTenant = z.infer<typeof SafeTenant>;