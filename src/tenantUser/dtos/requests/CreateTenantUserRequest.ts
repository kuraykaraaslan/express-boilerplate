import { z } from "zod";

export const CreateTenantUserRequest = z.object({
    tenantId: z.string().cuid(),
    userId: z.string().cuid(),
    tenantUserRole: z.enum(["ADMIN", "USER"]),
    tenantUserStatus: z.enum(["ACTIVE", "INACTIVE"]),
});

export type CreateTenantUserRequest = z.infer<typeof CreateTenantUserRequest>;