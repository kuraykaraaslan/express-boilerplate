import { TenantStatus } from "@prisma/client";

export default class TenantOmit {
    tenantId!: string;
    name!: string;
    tenantStatus!: TenantStatus;
    domain!: string;
}