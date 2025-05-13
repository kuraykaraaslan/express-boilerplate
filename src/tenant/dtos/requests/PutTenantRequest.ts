import { z } from "zod";

export const PutTenantRequest = z.object({
    tenantId: z.string().cuid(),
    domain: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    tenantStatus: z.enum(["ACTIVE", "INACTIVE"]),
}).refine((data) => {
    return (data.tenantStatus === "ACTIVE" || data.tenantStatus === "INACTIVE");
}, {
    message: "tenantStatus must be either ACTIVE or INACTIVE.",
});

export type PutTenantRequest = z.infer<typeof PutTenantRequest>;