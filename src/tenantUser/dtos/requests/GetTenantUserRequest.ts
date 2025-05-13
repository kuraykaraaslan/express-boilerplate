import { z } from "zod";

export const GetTenantUserRequest = z.object({
    tenantUserId: z.string().optional(),
    userId: z.string().optional(),
    tenantId: z.string().optional(),
}).refine((data) => {
    return (data.tenantUserId && !data.userId && !data.tenantId) || (!data.tenantUserId && data.userId && data.tenantId);
}, {
    message: "Either tenantUserId or userId and tenantId must be provided, but not both.",
});

export type GetTenantUserRequest = z.infer<typeof GetTenantUserRequest>;