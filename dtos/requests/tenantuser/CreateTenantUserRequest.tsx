import { User } from "@prisma/client";
export default class CreateTenantUserRequest {
    tenantId!: string;
    userId!: string;
    tenantUserRole!: string;
    tenantUserStatus!: string;
}