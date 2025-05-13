/**
 * TenantController.tsx
 * 
 * This module provides endpoints to manage tenant operations such as creating, updating, and deleting tenants.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// Utils

// DTOs
import { CreateTenantRequest } from "../dtos/requests/CreateTenantRequest";
import { GetTenantResponse } from "../dtos/responses/GetTenantResponse";
import { GetTenantsRequest } from "../dtos/requests/GetTenantsRequest";
import { GetTenantsResponse } from "../dtos/responses/GetTenantsResponse";
import { PutTenantRequest } from "../dtos/requests/PutTenantRequest";
import { GetTenantRequest } from "../dtos/requests/GetTenantRequest";

// Middlewares
import AuthMiddleware from "../../auth/middleware";
import TenantMiddleware from "../../tenantAuth/middleware";

// Tenant User Router
import TenantUserRouter from "../../tenantUser/router";
import TenantService from "../services";

//Permission Management

const tenantRouter = Router();

tenantRouter.use(AuthMiddleware("USER"));

/**
 * POST /tenants
 * Create a new tenant.
 */
tenantRouter.post('/',
    AuthMiddleware("ADMIN"),
    async (request: Request, response: Response<GetTenantResponse>) => {

        const parsed = CreateTenantRequest.safeParse(request.body);
        if (!parsed.success) {
            throw new Error("INVALID_TENANT_DATA");
        }
        const tenant = await TenantService.create(parsed.data);
        response.json({ tenant });
    });


/**
 * GET /tenants
 * Get all tenants.
 */
tenantRouter.get('/',
    AuthMiddleware("ADMIN"),
    async (request: Request, response: Response<GetTenantsResponse>) => {
        const data = new GetTenantsRequest(request.query);
        const { tenants, total } = await TenantService.getAll(data);

        response.json({ tenants, total });
    });


/**
 * GET /tenants/:tenantId
 * Get a tenant by ID.
 * 
 * @param tenantId The ID of the tenant.
 */
tenantRouter.get('/:tenantId',
    TenantMiddleware("USER"),
    async (request: Request, response: Response) => {


    });


/**
 * PUT /tenants/:tenantId
 * Update a tenant by ID.
 * 
    * @param tenantId The ID of the tenant.
    */
tenantRouter.put('/:tenantId',
    TenantMiddleware("ADMIN"),
    async (request: Request, response: Response<GetTenantResponse>) => {
        const data = new PutTenantRequest(request.body);

        if (request.params.tenantId !== data.tenantId) {
            throw new Error("TENANT_ID_MISMATCH");
        }

        const tenant = await TenantService.update(data);

        response.json({ tenant });
    });

/**
 * DELETE /tenants/:tenantId
 * Delete a tenant by ID.
 *
 * @param tenantId The ID of the tenant.
 * @returns The deleted tenant.
 */
tenantRouter.delete('/:tenantId',
    TenantMiddleware("ADMIN"),
    async (request: Request, response: Response<GetTenantResponse>) => {

        const data = new GetTenantRequest(request.params);
        const tenant = await TenantService.delete(data);
        response.json({ tenant });
    });


/** 
 * Tenant User Router
 * 
 * This module provides endpoints to manage tenant user operations such as creating, updating, and deleting tenant users.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */

tenantRouter.use('/users', TenantUserRouter);


export default tenantRouter;