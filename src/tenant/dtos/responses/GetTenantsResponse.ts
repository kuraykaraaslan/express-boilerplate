import { z } from "zod";
import { SafeTenant } from "../../types/SafeTenant";

export const GetTenantsResponse = z.object({
    tenants : z.array(SafeTenant),
    total: z.number(),
    page: z.number(),
    pageSize: z.number()
});

export type GetTenantsResponse = z.infer<typeof GetTenantsResponse>;