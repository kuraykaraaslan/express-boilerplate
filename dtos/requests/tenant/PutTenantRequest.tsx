import { User } from "@prisma/client";
export default class PutTenantRequest {
    tenantId!: string;
    domain!: string;
    name!: string;
    tenantStatus!: string;
}