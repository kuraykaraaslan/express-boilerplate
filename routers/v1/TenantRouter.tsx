/**
 * TenantController.tsx
 * 
 * This module provides endpoints to manage tenant operations such as creating, updating, and deleting tenants.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";
import TenantController from "../../controllers/TenantController";
import FieldValidater from "../../utils/FieldValidater";

// DTOs
import CreateTenantRequest from "../../dtos/requests/tenant/CreateTenantRequest";
import GetTenantResponse from "../../dtos/responses/tenant/GetTenantResponse";
import EmptyRequest from "../../dtos/requests/EmptyRequest";

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";
import GetTenantsRequest from "../../dtos/requests/tenant/GetTenantsRequest";
import GetTenantsResponse from "../../dtos/responses/tenant/GetTenantsResponse";
import TenantMiddleware from "../../middlewares/TenantMiddleware";
import PutTenantRequest from "../../dtos/requests/tenant/PutTenantRequest";

// Tenant User Router
import TenantUserRouter from "./TenantUserRouter";

const tenantRouter = Router();

tenantRouter.use(AuthMiddleware("USER"));

/**
 * POST /tenants
 * Create a new tenant.
 */
tenantRouter.post('/',
    AuthMiddleware("ADMIN"),
    async (request: Request<CreateTenantRequest>, response: Response<GetTenantResponse>) => {

        if (!FieldValidater.validateBody(request.body, CreateTenantRequest)) {
            throw new Error("BAD_REQUEST");
        }

        return await TenantController.create(request, response);
    });


/**
 * GET /tenants
 * Get all tenants.
 */
tenantRouter.get('/',
    AuthMiddleware("ADMIN"),
    async (request: Request<GetTenantsRequest>, response: Response<GetTenantsResponse>) => {

        if (!FieldValidater.validateBody(request.query, GetTenantsRequest)) {
            throw new Error("BAD_REQUEST");
        }
        return await TenantController.getAll(request, response);
    });


/**
 * GET /tenants/:tenantId
 * Get a tenant by ID.
 * 
 * @param tenantId The ID of the tenant.
 */
tenantRouter.get('/:tenantId',
    TenantMiddleware("USER"),
    async (request: Request<any>, response: Response<GetTenantResponse>) => {

        return await TenantController.getById(request, response);
    });


/**
 * PUT /tenants/:tenantId
 * Update a tenant by ID.
 * 
    * @param tenantId The ID of the tenant.
    */
tenantRouter.put('/:tenantId',
    TenantMiddleware("ADMIN"),
    async (request: Request<PutTenantRequest>, response: Response<GetTenantResponse>) => {

        console.log('tenantId:', request.params.tenantId);

        return await TenantController.update(request, response);
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
    async (request: Request<any>, response: Response<GetTenantResponse>) => {

        return await TenantController.delete(request, response);
    });


/** 
 * Tenant User Router
 * 
 * This module provides endpoints to manage tenant user operations such as creating, updating, and deleting tenant users.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */

tenantRouter.use('/users', TenantUserRouter);


export default tenantRouter;