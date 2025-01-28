import { NextFunction, Request, Response } from 'express';

// Services
import TenantService from '../services/TenantService';
import TenantUserService from '../services/TenantUserService';

// Omits
import UserOmit from '../types/UserOmit';

export default function (
    requiredRole: string = 'USER', 
    method: string = 'PATH' // PATH | DOMAIN
) {
    return async function tenantMiddleware(request: Request<any>, response: Response, next: NextFunction) {
        try {
            // Check if tenant user and tenant object already exist in the request
            if (request.tenantUser && request.tenant) {
                if (TenantUserService.checkIfUserHasRole(request.tenantUser, requiredRole)) {
                    return next();
                } else {
                    throw new Error("TENANT_USER_HAS_NOT_REQUIRED_ROLE");
                }
            }

            // Ensure the user object exists in the request
            if (!request.user) {
                throw new Error("USER_NOT_FOUND");
            }

            const user = request.user as UserOmit;
            let tenant;

            switch (method) {
                case 'PATH':
                    tenant = await TenantService.getById({ tenantId: request.params.tenantId });
                    break;
                case 'DOMAIN':
                    tenant = await TenantService.getById(request.body.tenantId);
                    break;
                default:
                    throw new Error("INVALID_METHOD");
            }

            if (!tenant) {
                throw new Error("TENANT_NOT_FOUND");
            }

            // Attach tenant to request
            request.tenant = tenant;

            let tenantUser = await TenantUserService.getById({ tenantId: tenant.tenantId, userId: user.userId });

            // If the user is an admin but not a tenant user, create a temporary tenant user
            if (!tenantUser && user.userRole === 'ADMIN') {
                tenantUser = {
                    tenantUserId: `TEMP_${tenant.tenantId}_${user.userId}`,
                    tenantId: tenant.tenantId,
                    userId: user.userId,
                    tenantUserRole: 'ADMIN',
                    tenantUserStatus: 'ACTIVE'
                };

                return next();
            }

            if (!tenantUser) {
                throw new Error("UNAUTHORIZED");
            }

            // Attach tenant user to request
            request.tenantUser = tenantUser;

            // Check if the tenant user has the required role
            if (!TenantUserService.checkIfUserHasRole(tenantUser, requiredRole)) {
                throw new Error("TENANT_USER_HAS_NOT_REQUIRED_ROLE");
            }

            return next();
        } catch (error: any) {
            response.status(401).json({ error: error.message });
        }
    };
}
