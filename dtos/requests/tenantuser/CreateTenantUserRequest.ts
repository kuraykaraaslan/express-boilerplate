import FieldValidater from "../../../utils/FieldValidater";

import { TenantUserRole, TenantUserStatus } from "@prisma/client";
export default class CreateTenantUserRequest {
    tenantId!: string;
    userId!: string;
    tenantUserRole!: TenantUserRole;
    tenantUserStatus!: TenantUserStatus;
}