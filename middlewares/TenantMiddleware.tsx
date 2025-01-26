/*
    This middleware is used to check if the user is authenticated and has the required role
    If the user is not authenticated, it will return 401
    If the user is authenticated but does not have the required role, it will return 401
    If the user is authenticated and has the required role, it will call the next middleware
    Default required role is 'USER'
*/
import { NextFunction, Request, Response } from 'express';

import { User } from '@prisma/client';

import AuthService from '../services/AuthService';
import TenantService from '../services/TenantService';
import UserOmit from '../types/UserOmit';
import TenantUserService from '../services/TenantUserService';

export default function (requiredRole: string) {

    return async function tenantMiddleware(request: Request, response: Response, next: NextFunction) {

        try {

            //if we dont have a user object in the request, then raise an error

            if (!request.user) {
                throw new Error("USER_NOT_FOUND");
            }

            const user = request.user as UserOmit;

            const tenant = await TenantService.get({ domain : request.headers.host });

            if (!tenant) {
                throw new Error("TENANT_NOT_FOUND");
            }

            // Now we have the tenant object, we can add it to the request
            request.tenant = tenant;

            let tenantUser = await TenantUserService.get({ tenantId: tenant.tenantId, userId: user.userId });

            if (!tenantUser) {
                /**
                 *  If the user is not a tenant user, then check if the user is a admin
                 * If the user is an admin, then create a tenant user temporarily
                 */
                if (user.userRole === 'ADMIN') {
                    
                    tenantUser = {
                        tenantUserId: 'TEMP_' + tenant.tenantId + '_' + user.userId,
                        tenantId: tenant.tenantId,
                        userId: user.userId,
                        tenantUserRole: 'ADMIN',
                        tenantUserStatus: 'ACTIVE'
                    }

                    next();

                }
            }

            if (!tenantUser) {
                throw new Error("UNAUTHORIZED");
            }

            if (tenantUser.tenantUserRole !== requiredRole) {
                throw new Error("UNAUTHORIZED");
            }

            next();

        } catch (error: any) {
            response.status(401).send({ error: error.message });
        }
    }
}
