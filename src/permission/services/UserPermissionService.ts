import { User, UserRole } from '@prisma/client';
import OPERATIONS from './Operations';


type RolePermissions = Record<OPERATIONS, boolean | string[]>;

export default class UserPermissionService {


    static readonly PERMISSIONS: Record<UserRole, RolePermissions> = {
        [UserRole.ADMIN]: {
            CREATE: true,
            READ: true,
            UPDATE: true,
            DELETE: true,
        },
        [UserRole.USER]: {
            CREATE: false,
            READ: ['email'],
            UPDATE: false,
            DELETE: false,
        },
    };

    static async hasPermission(
        operator: User,
        subject: User,
        operation: OPERATIONS
    ): Promise<boolean | string[]> {
        const rolePerms = UserPermissionService.PERMISSIONS[operator.userRole];
    
        // Kendi kaydı üzerinde özel izinler
        if (operator.userId === subject.userId) {
            if (operation === OPERATIONS.READ) return ['id', 'email', 'name'];
            if (operation === OPERATIONS.UPDATE) return ['email', 'name'];
            return false;
        }
    
        return rolePerms?.[operation] ?? false;
    }

    static async execute<T>({
        operator,
        subject,
        action,
        callback,
        fallback,
    }: {
        operator: User;
        subject: T extends object ? T : never;
        action: OPERATIONS;
        callback: (data?: Partial<T>) => Promise<any>;
        fallback?: (data: T) => Promise<any>;
    }): Promise<any> {
        const hasPermission = await UserPermissionService.hasPermission(
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
