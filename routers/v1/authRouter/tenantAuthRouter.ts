/**
 * Tenant Auth Router
 * 
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";
import TenantAuthService from "../../../services/v1/AuthService/TenantAuthService";
import GetTenantUserRequest from "../../../dtos/requests/tenantuser/GetTenantUserRequest";
import GetTenantUsersResponse from "../../../dtos/responses/tenantuser/GetTenantUsersResponse";
import TenantService from "../../../services/v1/TenantService";
import GetTenantRequest from "../../../dtos/requests/tenant/GetTenantRequest";
import TenantUserService from "../../../services/v1/TenantService/TenantUserService";


const tenantAuthRouter = Router();


/**
 * GET /login
 * Login page.
 * 
 * Response:
 * - list of tenant users
 *
 */

tenantAuthRouter.get('/', async (request: Request, response: Response<GetTenantUsersResponse>) => {

    const { user } = request;

    const { skip, take } = request.query;

    const data = new GetTenantUserRequest({
        skip: Number(skip), 
        take: Number(take),
        userId: user!.userId,
    });

    const { tenantUsers, total } = await TenantUserService.getAll(data);

    return response.status(200).json({
        tenantUsers,
        total
    });

});

/**
 * POST /set
 * Set tenant user.
 *
 * @param {string} tenantUserId - The ID of the tenant user to set.
 * 
 * Response:
 * - tenant user
 *
 */
tenantAuthRouter.post('/', async (request: Request<GetTenantUserRequest>, response: Response) => {

    const { tenantUserId } = request.body;

    const { user, userSession } = request;

    if (!tenantUserId) {
        throw new Error("BAD_REQUEST");
    }

    const data = new GetTenantUserRequest({
        tenantUserId,
        userId: user!.userId,
    });

    const { tenantUsers, total } = await TenantUserService.getAll(data);
    
    const tenantUser = tenantUsers[0];

    if (!tenantUser) {
        throw new Error("TENANT_USER_NOT_FOUND");
    }

    // Check if the tenant user is active
    if (tenantUser.tenantUserStatus !== "ACTIVE") {
        throw new Error("TENANT_USER_NOT_ACTIVE");
    }

    // Check if the tenant user belongs to the current user
    if (tenantUser.userId !== user!.userId) {
        throw new Error("TENANT_USER_NOT_BELONG_TO_USER");
    }

    // Check if the tenant is active
    const getTenantRequest = new GetTenantRequest({
        tenantId: tenantUser.tenantId,
    });

    const tenant = await TenantService.getById(getTenantRequest);

    if (!tenant) {
        throw new Error("TENANT_NOT_FOUND");
    }

    if (tenant.tenantStatus !== "ACTIVE") {
        throw new Error("TENANT_NOT_ACTIVE");
    }

    // Set the tenant user in the session
    const result = await TenantAuthService.setUserSessionTenantUser({ tenantUser , accessToken: userSession!.accessToken });

    if (!result) {
        throw new Error("TENANT_USER_SESSION_NOT_SET");
    }

    return response.status(200).json({
        tenantUser,
    });
}
);


export default tenantAuthRouter;

