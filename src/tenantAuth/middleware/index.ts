import { NextFunction, Request, Response } from 'express';

// Services
import TenantService from '../../tenant/services';
import TenantUserService from '../../tenantUser/services';
import TenantUserSessionService from '../services/TenantAuthService';

// Types
import {SafeUser} from '../../user/types/SafeUser';
import {GetTenantRequest} from '../../tenant/dtos/requests/GetTenantRequest';
import {GetTenantUserRequest} from '../../tenantUser/dtos/requests/GetTenantUserRequest';
import UserSessionService from '../../auth/services/UserSessionService';
/**
 * Middleware to validate and attach the current user's tenant context to the request.
 * 
 * Features:
 * - Ensures user and session token exist.
 * - Retrieves tenant information by tenantId from route.
 * - Loads cached SafeTenantUser from Redis using the session token.
 * - If the tenantId from Redis does not match the route param, the session is invalidated.
 * - If Redis is empty or corrupted, fallback to DB lookup and caches it again.
 * - If the user has an ADMIN role but no tenant user exists, creates a temporary SafeTenantUser.
 * - Validates tenant role permissions.
 * 
 * @param {string} requiredRole - The minimum tenant role required. Defaults to "USER".
 * @param {string} method - Defines how tenantId is resolved ("PATH" or "DOMAIN"). Currently only "PATH" is used.
 * @returns Express middleware function
 */
export default function (
    requiredRole: string = 'USER',
    method: string = 'PATH'
) {
    return async function tenantAuthMiddleware(request: Request, response: Response, next: NextFunction) {
            if (!request.user || !request.cookies?.accessToken) {
                throw new Error("USER_OR_SESSION_NOT_FOUND");
            }

            const user = request.user as SafeUser;
            const accessToken = request.cookies.accessToken;
            const tenantId = request.params.tenantId;

            const tenant = await TenantService.getById(new GetTenantRequest({ tenantId }));
            if (!tenant) throw new Error("TENANT_NOT_FOUND");

            // 1. Try fetching from Redis first
            let tenantUser = await TenantUserSessionService.getSafeTenantUserFromSession(accessToken);

            // 2. If Redis data exists but belongs to a different tenant, invalidate it
            if (tenantUser && tenantUser.tenantId !== tenant.tenantId) {
                await UserSessionService.deleteSession(accessToken);
                await TenantUserSessionService.deleteTenantUserSession(accessToken);
                tenantUser = null;
                throw new Error("SESSION_TENANT_MISMATCH");
            }

            // 3. If no cached data, fallback to DB
            if (!tenantUser) {
                const data = new GetTenantUserRequest({
                    tenantId: tenant.tenantId,
                    userId: user.userId,
                });

                const found = await TenantUserService.getById(data);

                if (found) {
                    await TenantUserSessionService.setUserSessionTenantUser({
                        tenantUser: found,
                        userSession: request.userSession,
                    });
                    tenantUser = found;
                } else {
                    // Allow ADMINs to temporarily access any tenant
                    if (user.userRole === 'ADMIN') {
                        tenantUser = {
                            tenantUserId: `TEMP_TENANT_USER_ID_${user.userId}`,
                            tenantId: tenant.tenantId,
                            userId: user.userId,
                            tenantUserRole: 'ADMIN',
                            tenantUserStatus: 'ACTIVE',
                        };

                        await TenantUserSessionService.setUserSessionTenantUser({
                            tenantUser,
                            userSession: request.userSession,
                        });
                    } else {
                        throw new Error("TENANT_USER_NOT_FOUND");
                    }
                }
            }

            // 4. Role check
            if (!TenantUserService.checkIfUserHasRole(tenantUser, requiredRole)) {
                throw new Error("TENANT_USER_HAS_NOT_REQUIRED_ROLE");
            }

            // 5. Attach tenantUser to the request object
            request.tenantUser = tenantUser;

            return next();

    };
}
