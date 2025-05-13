import { SafeTenantUser } from "../../types/SafeTenantUser";
import { z } from "zod";

export const GetTenantUserResponse = z.object({
    tenantUser: SafeTenantUser
});

export type GetTenantUserResponse = z.infer<typeof GetTenantUserResponse>;