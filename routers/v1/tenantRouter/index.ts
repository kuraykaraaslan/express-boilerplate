/**
 * TenantController.tsx
 * 
 * This module provides endpoints to manage tenant operations such as creating, updating, and deleting tenants.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// Utils

// DTOs
import CreateTenantRequest from "../../../dtos/requests/tenant/CreateTenantRequest";
import GetTenantResponse from "../../../dtos/responses/tenant/GetTenantResponse";
import GetTenantsRequest from "../../../dtos/requests/tenant/GetTenantsRequest";
import GetTenantsResponse from "../../../dtos/responses/tenant/GetTenantsResponse";
import TenantMiddleware from "../../../middlewares/v1/tenantMiddleware";
import PutTenantRequest from "../../../dtos/requests/tenant/PutTenantRequest";

// Middlewares
import AuthMiddleware from "../../../middlewares/v1/authMiddleware";

// Tenant User Router
import TenantUserRouter from "./tenantUserRouter";
import TenantService from "../../../services/v1/TenantService";
import GetTenantRequest from "../../../dtos/requests/tenant/GetTenantRequest";

//Permission Management
import PermissionService from "../../../services/v1/PermissionService";

const tenantRouter = Router();

tenantRouter.use(AuthMiddleware("USER"));

/**
 * POST /tenants
 * Create a new tenant.
 */
tenantRouter.post('/',
    AuthMiddleware("ADMIN"),
    async (request: Request, response: Response<GetTenantResponse>) => {

        const data = new CreateTenantRequest(request.body);
        const tenant = await TenantService.create(data);
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
    
        
        const result = await PermissionService.execute({
            request,
            action: "READ",
            subject: "Tenant",
            callback: async () => {
                const data = new GetTenantRequest(request.params);
                const tenant = await TenantService.getById(data);        
                return { tenant };
            },
            fallback: async () => {
                console.log("Permission denied");
            }
        });
        response.json(  result );
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