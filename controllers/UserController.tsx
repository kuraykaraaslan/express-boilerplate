import { Request, Response } from "express";
import UserOmit from "../types/UserOmit";
import GetUserRequest from "../dtos/requests/user/GetUserRequest";
import PutUserRequest from "../dtos/requests/user/PutUserRequest";
import UserService from "../services/UserService";
import FieldValidater from "../utils/FieldValidater";
import GetUsersResponse from "../dtos/responses/user/GetUsersResponse";
import GetUsersRequest from "../dtos/requests/user/GetUsersRequest";
import MessageResponse from "../dtos/responses/MessageResponse";


export default class UserController {

    public static async getById(request: Request<GetUserRequest>, response: Response<UserOmit>): Promise<Response<UserOmit>> {
        const { userId } = request.params;

        if (!FieldValidater.isCUID(userId)) {
            throw new Error("INVALID_USER_ID");
        }

        return response.json(await UserService.getById({ userId }));
    }

    public static async create(request: Request<PutUserRequest>, response: Response<UserOmit>): Promise<Response<UserOmit>> {
        
        const { email, password, name , role , phone , address } = request.body;

        if (!FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD");
        }

        if (name ? !FieldValidater.sanitizeString(name) : false) {
            throw new Error("INVALID_NAME");
        }

        if (phone ? !FieldValidater.isPhone(phone) : false) {
            throw new Error("INVALID_PHONE");
        }

        if (address ? !FieldValidater.sanitizeString(address) : false) {
            throw new Error("INVALID_ADDRESS");
        }

        if (role ? !FieldValidater.isRole(role) : false) {
            throw new Error("INVALID_ROLE");
        }

        return response.json(await UserService.create({ email, password }));
    }

    public static async get(request: Request<GetUsersRequest>, response: Response<GetUsersResponse>): Promise<Response<GetUsersResponse>> {
        
        let { skip, take, userId, tenantId, search } = request.query as any;

        if (skip ? !FieldValidater.isNumber(skip) : false) {
            throw new Error("INVALID_SKIP");
        }

        if (take ? !FieldValidater.isNumber(take) : false) {
            throw new Error("INVALID_TAKE");
        }
        
        if (userId ? !FieldValidater.isCUID(userId) : false) {
            throw new Error("INVALID_USER_ID");
        }

        if (tenantId ? !FieldValidater.isCUID(tenantId) : false) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (search ? !FieldValidater.sanitizeString(search) : false) {
            throw new Error("INVALID_SEARCH");
        }


        const data = { 
            skip: skip ? parseInt(skip) : 0, 
            take: take ? parseInt(take) : 10, 
            userId, 
            tenantId, 
            search 
        };

        return response.json(await UserService.get(data));
    }

    public static async update(request: Request<PutUserRequest>, response: Response<UserOmit>): Promise<Response<UserOmit>> {
        
        const { userId, email, name , role , phone , address} = request.body;

        if (!FieldValidater.isCUID(userId)) {
            throw new Error("INVALID_USER_ID");
        }

        // check if param userId is same as body userId
        if (userId !== request.params.userId) {
            throw new Error("INVALID_USER_ID");
        }

        if (email ? !FieldValidater.isEmail(email) : false) {
            throw new Error("INVALID_EMAIL");
        }

        if (name ? !FieldValidater.sanitizeString(name) : false) {
            throw new Error("INVALID_NAME");
        }

        if (phone ? !FieldValidater.isPhone(phone) : false) {
            throw new Error("INVALID_PHONE");
        }

        if (address ? !FieldValidater.sanitizeString(address) : false) {
            throw new Error("INVALID_ADDRESS");
        }

        if (role ? !FieldValidater.isRole(role) : false) {
            throw new Error("INVALID_ROLE");
        }

        // forbidden fields check
        const forbiddenFields = ["createdAt", "updatedAt", "password"];

        for (const field of forbiddenFields) {
            if (request.body[field]) {
                throw new Error("FORBIDDEN_FIELD");
            }
        }

        return response.json(await UserService.update(request.body));
    }

    public static async delete(request: Request<GetUserRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {
        const { userId } = request.params;

        if (!FieldValidater.isCUID(userId)) {
            throw new Error("INVALID_USER_ID");
        }

        await UserService.delete({ userId });

        return response.json({ message: "USER_DELETED" });
    }


}