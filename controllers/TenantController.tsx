import { Request, Response } from "express";

import TenantOmit from "../types/TenantOmit";
import TenantService from "../services/TenantService";
import FieldValidater from "../utils/FieldValidater";
import GetTenantsRequest from "@/dtos/requests/tenant/GetTenantsRequest";
import GetTenantsResponse from "../dtos/responses/tenant/GetTenantsResponse";
import GetTenantRequest from "../dtos/requests/tenant/GetTenantRequest";
import GetTenantResponse from "../dtos/responses/tenant/GetTenantResponse";
import CreateTenantRequest from "@/dtos/requests/tenant/CreateTenantRequest";
import PutTenantRequest from "@/dtos/requests/tenant/PutTenantRequest";


export default class TenantController {

    public static async getById(request: Request<GetTenantRequest>, response: Response<GetTenantResponse>): Promise<Response<GetTenantResponse>> {
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

    }

    public static async getAll(request: Request<GetTenantsRequest>, response: Response<GetTenantsResponse>): Promise<Response<GetTenantsResponse>> {        
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

        return response.json(await TenantService.getAll(data));
    }

    public static async create(request: Request<CreateTenantRequest>, response: Response<GetTenantResponse>): Promise<Response<GetTenantResponse>> {

        const { name, domain, tenantStatus } = request.body;

        if (!FieldValidater.isName(name)) {
            throw new Error("INVALID_NAME");
        }

        if (!FieldValidater.isDomain(domain)) {
            throw new Error("INVALID_DOMAIN");
        }

        const tenant = await TenantService.create({ name, domain , tenantStatus });

        return response.json({ tenant });
    }


    public static async update(request: Request<PutTenantRequest>, response: Response<GetTenantResponse>): Promise<Response<GetTenantResponse>> {

        const { tenantId, name, domain, tenantStatus } = request.body;

        if (!FieldValidater.isName(name)) {
            throw new Error("INVALID_NAME");
        }

        if (!FieldValidater.isDomain(domain)) {
            throw new Error("INVALID_DOMAIN");
        }


        // TODO: Check tenant status


        if (!FieldValidater.isCUID(tenantId)) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (tenantId !== request.query.tenantId) {
            throw new Error("INVALID_TENANT_ID");
        }

        const tenant = await TenantService.update({ tenantId, name, domain, tenantStatus });

        return response.json({ tenant });
    }

}