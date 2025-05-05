/**
 * Tenant Auth Router
 * 
 * This module provides endpoints to manage user authentication operations such as registration and login.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";
import GetTenantUserRequest from "../../../dtos/requests/tenantuser/GetTenantUserRequest";
import GetTenantUsersResponse from "../../../dtos/responses/tenantuser/GetTenantUsersResponse";
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

    response.status(200).json({
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

    // TODO: İMPLEMENT THIS
}
);


export default tenantAuthRouter;

