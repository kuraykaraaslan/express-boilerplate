import { z } from "zod";

export const GetTenantUsersRequest = z.object({
    skip: z.number().optional(),
    take: z.number().optional(),
    userId: z.string().optional(),
    search: z.string().optional(),
    tenantId: z.string().optional(),
    tenantUserId: z.string().optional(),
}).refine((data) => {
    return (data.tenantUserId && !data.userId && !data.tenantId) || (!data.tenantUserId && data.userId && data.tenantId);
}, {
    message: "Either tenantUserId or userId and tenantId must be provided, but not both.",
});

export type GetTenantUsersRequest = z.infer<typeof GetTenantUsersRequest>;