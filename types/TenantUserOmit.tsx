import { TenantUserRole , TenantUserStatus } from '@prisma/client';

export default interface TenantUserOmit {
    tenantUserId: string;
    tenantId: string;
    userId: string;
    tenantUserRole: TenantUserRole;
    tenantUserStatus: TenantUserStatus;
}