import { z } from "zod";

export const CreateTenantRequest = z.object({
    name: z.string().min(1).max(100),
    domain: z.string().min(1).max(100),
    tenantStatus: z.enum(["ACTIVE", "INACTIVE"]).optional(),
}).refine((data) => {
    return (data.tenantStatus === "ACTIVE" || data.tenantStatus === "INACTIVE");
}, {
    message: "tenantStatus must be either ACTIVE or INACTIVE.",
})

export type CreateTenantRequest = z.infer<typeof CreateTenantRequest>;