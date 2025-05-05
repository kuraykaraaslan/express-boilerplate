import { TenantUserRole , TenantUserStatus } from '@prisma/client';
import SafeTenant from './SafeTenant';
import SafeUser from './SafeUser';

export default interface SafeTenantUser {
    tenantUserId: string;
    tenantId: string;
    userId: string;
    
    tenantUserRole: TenantUserRole;
    tenantUserStatus: TenantUserStatus;

    tenant?: SafeTenant;
    user?: SafeUser;

}