import { User , UserRole } from '@prisma/client';

export enum UserOperation {
    CREATE = 'CREATE',
    READ = 'READ',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE',
}

export default class UserPermissionService {

    static readonly OPERATIONS = {
        CREATE: 'CREATE',
        READ: 'READ',
        UPDATE: 'UPDATE',
        DELETE: 'DELETE',
    };
    
    static readonly PERMISSIONS = {
        [UserRole.ADMIN]: {
            CREATE: true,
            READ: true,
            UPDATE: true,
            DELETE: true,
        },
        [UserRole.USER]: {
            CREATE: false,
            READ: false,
            UPDATE: false,
            DELETE: false,
        },
    };
    
    static async hasPermission(operator: User, subject: User, operation: string): Promise<boolean> {
        // Check if the operation is valid
        if (!Object.values(UserPermissionService.OPERATIONS).includes(operation)) {
            throw new Error(`Invalid operation: ${operation}`);
        }
    
        const rolePerms = UserPermissionService.PERMISSIONS[operator.userRole];
    
        return rolePerms?.[operation as keyof typeof rolePerms] ?? false;
    }
}