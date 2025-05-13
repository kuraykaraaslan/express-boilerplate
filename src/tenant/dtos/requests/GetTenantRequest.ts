import { z } from "zod";

export const GetTenantRequest = z.object({
    tenantId: z.string().optional(),
    domain: z.string().optional(),
}).refine((data) => {
    return (data.tenantId && !data.domain) || (!data.tenantId && data.domain);
}, {
    message: "Either tenantId or domain must be provided, but not both.",
});

export type GetTenantRequestType = z.infer<typeof GetTenantRequest>;