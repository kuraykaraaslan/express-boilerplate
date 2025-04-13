import { TenantUserRole , TenantUserStatus } from '@prisma/client';
import TenantOmit from './TenantOmit';
import UserOmit from './UserOmit';

export default interface TenantUserOmit {
    tenantUserId: string;
    tenantId: string;
    userId: string;
    
    tenantUserRole: TenantUserRole;
    tenantUserStatus: TenantUserStatus;

    tenant?: TenantOmit;
    user?: UserOmit;

}