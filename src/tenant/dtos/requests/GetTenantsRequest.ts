import { z } from "zod";

export const GetTenantsRequest = z.object({
    skip: z.number().optional(),
    take: z.number().optional(),
    search: z.string().optional(),
    tenantId: z.string().optional(),
}).refine((data) => {
    return (data.tenantId && !data.search) || (!data.tenantId && data.search);
}, {
    message: "Either tenantId or search must be provided, but not both.",
});
export type GetTenantsRequest = z.infer<typeof GetTenantsRequest>;