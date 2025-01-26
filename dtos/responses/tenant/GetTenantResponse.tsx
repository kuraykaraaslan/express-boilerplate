import TenantOmit from "@/types/TenantOmit";
import { TenantStatus } from "@prisma/client";

export default interface GetTenantResponse {
    tenant: TenantOmit;
}
