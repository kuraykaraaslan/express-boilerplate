
import { z } from "zod";
import { SafeTenantUser } from "../../types/SafeTenantUser";

export const GetTenantUsersResponse = z.object({
    tenantUsers: z.array(SafeTenantUser),
    total: z.number(),
    page: z.number(),
    pageSize: z.number()
});

export type GetTenantUsersResponse = z.infer<typeof GetTenantUsersResponse>;