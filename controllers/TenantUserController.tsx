import { Request, Response } from "express";

import TenantOmit from "../types/TenantOmit";
import TenantUserOmit from "../types/TenantUserOmit";

import TenantUserService from "../services/TenantUserService";

import FieldValidater from "../utils/FieldValidater";

import GetTenantUsersRequest from "../dtos/requests/tenantuser/GetTenantUsersRequest";
import GetTenantUsersResponse from "../dtos/responses/tenantuser/GetTenantUsersResponse";
import GetTenantUserRequest from "../dtos/requests/tenantuser/GetTenantUserRequest";
import GetTenantUserResponse from "../dtos/responses/tenantuser/GetTenantUserResponse";
import CreateTenantUserRequest from "../dtos/requests/tenantuser/CreateTenantUserRequest";
import PutTenantUserRequest from "../dtos/requests/tenantuser/PutTenantUserRequest";

export default class TenantUserController {

    public static async getById(request: Request<GetTenantUserRequest>, response: Response<GetTenantUserResponse>): Promise<Response<GetTenantUserResponse>> {
        const { tenantUserId } = request.params;

        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        const tenantUser = await TenantUserService.getById({ tenantUserId });

        if (!tenantUser) {
            throw new Error("TENANT_USER_NOT_FOUND");
        }

        return response.json({ tenantUser });

    }

    public static async getAll(request: Request<GetTenantUsersRequest>, response: Response<GetTenantUsersResponse>): Promise<Response<GetTenantUsersResponse>> {
        let { skip, take, search } = request.query as any;

        if (skip ? !FieldValidater.isNumber(skip) : false) {
            throw new Error("INVALID_SKIP");
        }

        if (take ? !FieldValidater.isNumber(take) : false) {
            throw new Error("INVALID_TAKE");
        }

        const data = {
            skip: skip ? parseInt(skip) : 0,
            take: take ? parseInt(take) : 10,
            search: search ? search : ''
        };

        return response.json(await TenantUserService.getAll(data));

    }

    public static async create(request: Request<CreateTenantUserRequest>, response: Response<TenantUserOmit>): Promise<Response<TenantUserOmit>> {
        const { tenantId, userId, tenantUserRole , tenantUserStatus } = request.body;

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

        return response.json(await TenantUserService.create({ tenantId, userId, tenantUserRole, tenantUserStatus }));

    }

    public static async put(request: Request<PutTenantUserRequest>, response: Response<TenantUserOmit>): Promise<Response<TenantUserOmit>> {
        const { tenantUserId } = request.params;
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

        return response.json(await TenantUserService.update({ tenantUserId, tenantUserRole, tenantUserStatus }));

    }

    public static async delete(request: Request<GetTenantUserRequest>, response: Response<TenantUserOmit>): Promise<Response<TenantUserOmit>> {
        const { tenantUserId } = request.params;

        if (!FieldValidater.isCUID(tenantUserId)) {
            throw new Error("INVALID_TENANT_USER_ID");
        }

        return response.json(await TenantUserService.delete({ tenantUserId }));

    }


}