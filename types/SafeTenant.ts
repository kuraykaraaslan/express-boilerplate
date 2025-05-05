import {  TenantStatus } from "@prisma/client";

export default interface SafeTenant {
    tenantId: string;
    name: string;
    description?: string;
    tenantStatus: TenantStatus;
    domain: string;
    region: string;
    createdAt: Date;
    updatedAt: Date;
    deletedAt?: Date;
}
