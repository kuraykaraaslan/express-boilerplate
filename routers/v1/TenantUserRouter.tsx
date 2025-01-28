/**
 * TenantUserController.tsx
 * 
 * This module provides endpoints to manage tenant user operations such as creating, updating, and deleting tenants.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";
import TenantUserController from "../../controllers/TenantUserController";
import FieldValidater from "../../utils/FieldValidater";

// DTOs
import CreateTenantUserRequest from "../../dtos/requests/tenantuser/CreateTenantUserRequest";
import GetTenantUserResponse from "../../dtos/responses/tenantuser/GetTenantUserResponse";
import EmptyRequest from "../../dtos/requests/EmptyRequest";
import PutTenantUserRequest from "../../dtos/requests/tenantuser/PutTenantUserRequest";
import GetTenantUsersRequest from "../../dtos/requests/tenantuser/GetTenantUsersRequest";
import GetTenantUsersResponse from "../../dtos/responses/tenantuser/GetTenantUsersResponse";

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";
import TenantMiddleware from "../../middlewares/TenantMiddleware";
import GetTenantUserRequest from "@/dtos/requests/tenantuser/GetTenantUserRequest";


const tenantUserRouter = Router();

tenantUserRouter.use(AuthMiddleware("USER"));

/**
 * POST /tenantusers
 * Create a new tenant user. 
 * Only ADMIN users can create tenant users.
 */
tenantUserRouter.post('/',
    TenantMiddleware("ADMIN"),
    async (request: Request<CreateTenantUserRequest>, response: Response<GetTenantUserResponse>) => {

        if (!FieldValidater.validateBody(request.body, CreateTenantUserRequest)) {
            throw new Error("BAD_REQUEST");
        }

        return await TenantUserController.create(request, response);
    });



/**
 * GET /tenantusers
 * Get all tenant users.
 * Only Tenant Users can get all tenant users.
 */
tenantUserRouter.get('/',
    TenantMiddleware("USER"),
    async (request: Request<GetTenantUsersRequest>, response: Response<GetTenantUsersResponse>) => {

        if (!FieldValidater.validateBody(request.query, GetTenantUsersRequest)) {
            throw new Error("BAD_REQUEST");
        }
        return await TenantUserController.getAll(request, response);
    });

/**
 * GET /tenantusers/:tenantUserId
 * Get a tenant user by ID.
 * Only Tenant Users can get a tenant user by ID.
 */
tenantUserRouter.get('/:tenantUserId',
    TenantMiddleware("USER"),
    async (request: Request<GetTenantUserRequest>, response: Response<GetTenantUserResponse>) => {


        const { tenantUserId } = request.params;

        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        // Attach tenantUserId to request body
        request.body.tenantUserId = tenantUserId;

        return await TenantUserController.getById(request, response);
    });

/**
 * PUT /tenantusers/:tenantUserId
 * Update a tenant user by ID.
 * Only Tenant Admin can update a tenant user by ID.
 */
tenantUserRouter.put('/:tenantUserId',
    TenantMiddleware("ADMIN"),
    async (request: Request<PutTenantUserRequest>, response: Response<GetTenantUserResponse>) => {

        const { tenantUserId } = request.params;

        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        // Attach tenantUserId to request body
        request.body.tenantUserId = tenantUserId;

        if (!FieldValidater.validateBody(request.body, PutTenantUserRequest)) {
            throw new Error("BAD_REQUEST");
        }

        return await TenantUserController.update(request, response);
    });

/**
 * DELETE /tenantusers/:tenantUserId
 * Delete a tenant user by ID.
 * Only Tenant Admin can delete a tenant user by ID.
 */
tenantUserRouter.delete('/:tenantUserId',
    TenantMiddleware("ADMIN"),
    async (request: Request<GetTenantUserRequest>, response: Response) => {

        const { tenantUserId } = request.params;

        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        // Attach tenantUserId to request body 
        request.body.tenantUserId = tenantUserId;

        if (!FieldValidater.validateBody(request.body, EmptyRequest)) {
            throw new Error("BAD_REQUEST");
        }

        return await TenantUserController.delete(request, response);
    });


export default tenantUserRouter;
