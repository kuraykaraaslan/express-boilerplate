import { z } from "zod";
import { SafeTenant } from "../../types/SafeTenant";

export const GetTenantResponse = z.object({
    tenant : SafeTenant
});

export type GetTenantResponse = z.infer<typeof GetTenantResponse>;