import { NextFunction, Request, Response } from 'express';

// Services
import TenantService from '../../services/v1/TenantService';
import TenantUserService from '../../services/v1/TenantService/TenantUserService';

// Omits
import SafeUser from '../../types/SafeUser';
import GetTenantRequest from '../../dtos/requests/tenant/GetTenantRequest';
import GetTenantUserRequest from '../../dtos/requests/tenantuser/GetTenantUserRequest';
import SafeTenantUser from '../../types/SafeTenantUser';

export default function (
    requiredRole: string = 'USER', 
    method: string = 'PATH' // PATH | DOMAIN
) {
    return async function tenantMiddleware(request: Request<any>, response: Response, next: NextFunction) {
        try {
            // Check if tenant user and tenant object already exist in the request
            if (request.tenantUser) {
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

            const user = request.user as SafeUser;
            const tenantId = request.params.tenantId;
    
            const dataPath = new GetTenantRequest({ tenantId });
            const tenant = await TenantService.getById(dataPath);

            if (!tenant) {
                throw new Error("TENANT_NOT_FOUND");
            }
            
            const data = new GetTenantUserRequest({
                tenantId: tenant.tenantId,
                userId: user.userId,
            })

            const tenantUser = await TenantUserService.getById(data);

            if (!tenantUser) {
                //if tenant user not found but user is admin, then create a temporary tenant user
                if (user.userRole === 'ADMIN') {
                    const temporaryTenantUser : SafeTenantUser = {
                        tenantUserId: 'TEMP_TENANT_USER_ID_' + user.userId,
                        tenantId: tenant.tenantId,
                        userId: user.userId,
                        tenantUserRole: 'ADMIN',
                        tenantUserStatus: 'ACTIVE',
                    };

                    request.tenantUser = temporaryTenantUser;


                } else {
                    throw new Error("TENANT_USER_NOT_FOUND");
                }

            } else {
                // Attach tenant user to request
                request.tenantUser = tenantUser;
            }

            return next();
        } catch (error: any) {
            response.status(401).json({ error: error.message });
        }
    };
}
