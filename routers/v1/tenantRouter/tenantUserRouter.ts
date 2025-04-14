/**
 * TenantUserController.tsx
 * 
 * This module provides endpoints to manage tenant user operations such as creating, updating, and deleting tenants.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// Utils
import FieldValidater from "../../../utils/FieldValidater";

// DTOs
import CreateTenantUserRequest from "../../../dtos/requests/tenantuser/CreateTenantUserRequest";
import GetTenantUserResponse from "../../../dtos/responses/tenantuser/GetTenantUserResponse";
import EmptyRequest from "../../../dtos/requests/EmptyRequest";
import PutTenantUserRequest from "../../../dtos/requests/tenantuser/PutTenantUserRequest";
import GetTenantUsersRequest from "../../../dtos/requests/tenantuser/GetTenantUsersRequest";
import GetTenantUsersResponse from "../../../dtos/responses/tenantuser/GetTenantUsersResponse";
import GetTenantUserRequest from "../../../dtos/requests/tenantuser/GetTenantUserRequest";

// Middlewares
import AuthMiddleware from "../../../middlewares/v1/authMiddleware";
import TenantMiddleware from "../../../middlewares/v1/tenantMiddleware";
import TenantUserService from "../../../services/v1/TenantService/TenantUserService";

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

        const { tenantId, userId, tenantUserRole, tenantUserStatus } = request.body;

        if (!FieldValidater.isCUID(tenantId)) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (!FieldValidater.isCUID(userId)) {
            throw new Error("INVALID_USER_ID");
        }

        if (!FieldValidater.isTenantUserRole(tenantUserRole)) {
            throw new Error("INVALID_TENANT_USER_ROLE");
        }

        if (!FieldValidater.isTenantUserStatus(tenantUserStatus)) {
            throw new Error("INVALID_TENANT_USER_STATUS");
        }

        request.body.tenantId = tenantId;

        const tenantUser = await TenantUserService.create(request.body);
        return response.json({ tenantUser });
    });

/**
 * GET /tenantusers
 * Get all tenant users.
 * Only Tenant Users can get all tenant users.
 */
tenantUserRouter.get('/',
    TenantMiddleware("USER"),
    async (request: Request<GetTenantUsersRequest>, response: Response<GetTenantUsersResponse>) => {

        let { skip, take, search } = request.query as any;

        if (skip ? !FieldValidater.isNumber(skip) : false) {
            throw new Error("INVALID_SKIP");
        }

        if (take ? !FieldValidater.isNumber(take) : false) {
            throw new Error("INVALID_TAKE");
        }

        const data = new GetTenantUsersRequest({
            skip: skip ? parseInt(skip) : 0,
            take: take ? parseInt(take) : 10,
            search: search ? search : "",
        });

        const { tenantUsers, total } = await TenantUserService.getAll(data);
        return response.json({ tenantUsers, total });
    });

/**
 * GET /tenantusers/:tenantUserId
 * Get a tenant user by ID.
 * Only Tenant Users can get a tenant user by ID.
 */
tenantUserRouter.get('/:tenantUserId',
    TenantMiddleware("USER"),
    async (request: Request, response: Response<GetTenantUserResponse>) => {


        const { tenantUserId } = request.params;

        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        const data = new GetTenantUserRequest({
            tenantUserId: tenantUserId,
        });

        return await TenantUserService.getById(data);

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

        const { tenantUserRole, tenantUserStatus } = request.body;

        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        if (!FieldValidater.isTenantUserRole(tenantUserRole)) {
            throw new Error("INVALID_TENANT_USER_ROLE");
        }

        if (!FieldValidater.isTenantUserStatus(tenantUserStatus)) {
            throw new Error("INVALID_TENANT_USER_STATUS");
        }

        const tenantUser = await TenantUserService.update(request.body);

        return response.json({ tenantUser });

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


        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        const tenantUser = await TenantUserService.delete(request.body);

        return response.json({ tenantUser });
    });


export default tenantUserRouter;
