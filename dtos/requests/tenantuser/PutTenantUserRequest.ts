import FieldValidater from "../../../utils/FieldValidater";

import { TenantUserRole, TenantUserStatus } from "@prisma/client";

export default class PutTenantUserRequest {
    tenantUserId!: string;
    tenantUserRole!: TenantUserRole;
    tenantUserStatus!: TenantUserStatus;
}