/**
 * TenantController.tsx
 * 
 * This module provides endpoints to manage tenant operations such as creating, updating, and deleting tenants.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// Utils
import FieldValidater from "../../utils/FieldValidater";

// DTOs
import CreateTenantRequest from "../../dtos/requests/tenant/CreateTenantRequest";
import GetTenantResponse from "../../dtos/responses/tenant/GetTenantResponse";
import GetTenantsRequest from "../../dtos/requests/tenant/GetTenantsRequest";
import GetTenantsResponse from "../../dtos/responses/tenant/GetTenantsResponse";
import TenantMiddleware from "../../middlewares/TenantMiddleware";
import PutTenantRequest from "../../dtos/requests/tenant/PutTenantRequest";

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";

// Tenant User Router
import TenantUserRouter from "./TenantUserRouter";
import TenantService from "@/services/TenantService";

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


        const { name, domain, tenantStatus } = request.body;

        if (!FieldValidater.isName(name)) {
            throw new Error("INVALID_NAME");
        }

        if (!FieldValidater.isDomain(domain)) {
            throw new Error("INVALID_DOMAIN");
        }

        const tenant = await TenantService.create({ name, domain, tenantStatus });

        return response.json({ tenant });
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
        let { skip, take, tenantId, domain, search } = request.query as any;

        if (skip ? !FieldValidater.isNumber(skip) : false) {
            throw new Error("INVALID_SKIP");
        }

        if (take ? !FieldValidater.isNumber(take) : false) {
            throw new Error("INVALID_TAKE");
        }

        if (tenantId ? !FieldValidater.isCUID(tenantId) : false) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (domain ? !FieldValidater.isDomain(domain) : false) {
            throw new Error("INVALID_DOMAIN");
        }

        const data = {
            skip: skip ? parseInt(skip) : 0,
            take: take ? parseInt(take) : 10,
            search: search ? search : ''
        };

        const { tenants, total } = await TenantService.getAll(data);

        return response.json({ tenants, total });
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

        const { tenantId, domain } = request.params;

        if (tenantId ? !FieldValidater.isCUID(tenantId) : false) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (domain ? !FieldValidater.isDomain(domain) : false) {
            throw new Error("INVALID_DOMAIN");
        }

        const tenant = await TenantService.getById({ tenantId, domain });

        if (!tenant) {
            throw new Error("TENANT_NOT_FOUND");
        }

        return response.json({ tenant });

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

        if (!FieldValidater.validateBody(request.body, PutTenantRequest)) {
            throw new Error("BAD_REQUEST");
        }

        const { tenantId, name, domain, tenantStatus } = request.body;

        if (!FieldValidater.isName(name)) {
            throw new Error("INVALID_NAME");
        }

        if (!FieldValidater.isDomain(domain)) {
            throw new Error("INVALID_DOMAIN");
        }


        if (!FieldValidater.isCUID(tenantId)) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (!FieldValidater.isTenantStatus(tenantStatus)) {
            throw new Error("INVALID_TENANT_STATUS");
        }

        if (tenantId !== request.query.tenantId) {
            throw new Error("INVALID_TENANT_ID");
        }

        const tenant = await TenantService.update({ tenantId, name, domain, tenantStatus });

        return response.json({ tenant });
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

        const { tenantId } = request.params;

        if (!FieldValidater.isCUID(tenantId)) {
            throw new Error("INVALID_TENANT_ID");
        }

        const tenant = await TenantService.delete({ tenantId });

        return response.json({ tenant });
    });


/** 
 * Tenant User Router
 * 
 * This module provides endpoints to manage tenant user operations such as creating, updating, and deleting tenant users.
 * It uses the AuthService to interact with the database and perform necessary actions.
 */

tenantRouter.use('/users', TenantUserRouter);


export default tenantRouter;