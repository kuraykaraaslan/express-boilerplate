import { NextFunction, Request, Response } from 'express';

// Services
import TenantService from '@/services/v1/TenantService';
import TenantUserService from '@/services/v1/TenantService/TenantUserService';

// Omits
import UserOmit from '@/types/UserOmit';
import GetTenantRequest from '@/dtos/requests/tenant/GetTenantRequest';

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
                    const data = new GetTenantRequest(request.params);
                    tenant = await TenantService.getById(data);
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

            console.log("Tenant found: ", tenant);
            // Check if tenant user exists

            const getTenantUserRequest = new GetTenantRequest(request.params);

            return next();
        } catch (error: any) {
            response.status(401).json({ error: error.message });
        }
    };
}
