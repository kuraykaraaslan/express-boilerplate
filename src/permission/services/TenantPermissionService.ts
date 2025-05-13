import { Tenant , TenantUser, TenantUserRole, User } from '@prisma/client';
import TenantUserService from '../../tenantUser/services';
import GetTenantUserRequest from '../../tenantUser/dtos/requests/GetTenantUserRequest';
import PermissionService from '../../../services/v1/PermissionService';
import OPERATIONS from '../../../services/v1/PermissionService/Operations';
import SafeTenantUser from '@/types/SafeTenantUser';

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
    
    static async hasPermission(
        operator: SafeTenantUser,
        subject: Tenant,
        operation: OPERATIONS
    ): Promise<boolean | string[]> {
        
        const rolePerms = TenantPermissionService.PERMISSIONS[operator.tenantUserRole];

        // Check if the operation is valid
        if (!Object.values(TenantPermissionService.OPERATIONS).includes(operation)) {
            throw new Error(`Invalid operation: ${operation}`);
        }
    
        // If the subject id is not  same as the operator's tenant id, kick out
        if (operator.tenantId !== subject.tenantId) {
            throw new Error(`Permission denied for action: ${operation}`);
        }

        // If the operator is an admin, allow all operations
        if (operator.tenantUserRole === TenantUserRole.ADMIN) {
            return true;
        }

        // If the operator is a user, check their permissions 
    
        return rolePerms?.[operation] ?? false;
    }


    static async execute<T>({
        operator,
        subject,
        action,
        callback,
        fallback,
    }: {
        operator: TenantUser;
        subject: T extends object ? T : never;
        action: OPERATIONS;
        callback: (data?: Partial<T>) => Promise<any>;
        fallback?: (data: T) => Promise<any>;
    }): Promise<any> {
        const hasPermission = await TenantPermissionService.hasPermission(
            operator,
            subject as any,
            action
        );

        if (hasPermission) {
            if (typeof hasPermission === 'boolean') {
                return await callback(subject);
            } else if (Array.isArray(hasPermission)) {
                const filteredSubject = Object.keys(subject)
                    .filter((key) => hasPermission.includes(key))
                    .reduce((obj, key) => {
                        obj[key as keyof T] = subject[key as keyof T];
                        return obj;
                    }, {} as Partial<T>);

                return await callback(filteredSubject);
            }
        } else {
            if (fallback) {
                return await fallback(subject);
            }
            throw new Error(`Permission denied for action: ${action}`);
        }
    }
}
