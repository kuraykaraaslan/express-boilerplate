import { Tenant , TenantUserRole, User } from '@prisma/client';
import TenantUserService from '../TenantService/TenantUserService';
import GetTenantUserRequest from '../../../dtos/requests/tenantuser/GetTenantUserRequest';

export enum TenantOperation {
    CREATE = 'CREATE',
    READ = 'READ',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE',
}

export default class TenantPermissionService {

    static readonly OPERATIONS = {
        CREATE: 'CREATE',
        READ: 'READ',
        UPDATE: 'UPDATE',
        DELETE: 'DELETE',
    };
    
    static readonly PERMISSIONS = {
        [TenantUserRole.ADMIN]: {
            CREATE: true,
            READ: true,
            UPDATE: true,
            DELETE: true,
        },
        [TenantUserRole.USER]: {
            CREATE: false,
            READ: true,
            UPDATE: false,
            DELETE: false,
        },
    };
    
    static async hasPermission(operator: User, subject: Tenant, operation: string): Promise<boolean> {

        // Check if the operation is valid
        if (!Object.values(TenantPermissionService.OPERATIONS).includes(operation)) {
            throw new Error(`Invalid operation: ${operation}`);
        }

        const tenantUser = await TenantUserService.getById(new GetTenantUserRequest({
            tenantId: subject.tenantId,
            userId: operator.userId,
        }));
    
        if (!tenantUser) return false;
    
        const rolePerms = TenantPermissionService.PERMISSIONS[tenantUser.tenantUserRole];
    
        return rolePerms?.[operation as keyof typeof rolePerms] ?? false;
    }
}

