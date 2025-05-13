import { z } from "zod";

export const PutTenantUserRequest = z.object({
    tenantUserId: z.string().cuid(),
    tenantUserRole: z.enum(["ADMIN", "USER"]),
    tenantUserStatus: z.enum(["ACTIVE", "INACTIVE"]),
}).refine((data) => {
    return (data.tenantUserId && data.tenantUserRole && data.tenantUserStatus);
}, {
    message: "tenantUserId, tenantUserRole and tenantUserStatus must be provided.",
});

export type PutTenantUserRequest = z.infer<typeof PutTenantUserRequest>;