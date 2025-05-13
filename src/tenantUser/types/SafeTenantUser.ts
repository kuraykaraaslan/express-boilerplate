import { z } from "zod";
import { SafeTenant } from "@/src/tenant/types/SafeTenant";
import { SafeUser } from "@/src/user/types/SafeUser";

export const SafeTenantUser = z.object({
    tenantUserId: z.string().cuid(),
    tenantId: z.string().cuid(),
    userId: z.string().cuid(),
    
    tenantUserRole: z.enum(["ADMIN", "USER"]),
    tenantUserStatus: z.enum(["ACTIVE", "INACTIVE"]),

    tenant: SafeTenant.optional(),
    user: SafeUser.optional()
}).strict();

export type SafeTenantUser = z.infer<typeof SafeTenantUser>;
