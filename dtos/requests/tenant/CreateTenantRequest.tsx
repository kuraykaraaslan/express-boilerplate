import { TenantStatus, User } from "@prisma/client";
export default class CreateTenantRequest {
    domain!: string;
    name!: string;
    tenantStatus!: TenantStatus;
}