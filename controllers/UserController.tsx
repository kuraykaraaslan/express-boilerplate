import { Request, Response } from "express";
import OmitPasswordUserResponse from "../dtos/responses/OmitPasswordUserResponse";
import GetUserRequest from "../dtos/requests/GetUserRequest";
import PutUserRequest from "../dtos/requests/PutUserRequest";
import UserService from "../services/UserService";
import FieldValidater from "../utils/FieldValidater";
import GetUsersResponse from "../dtos/responses/GetUsersResponse";
import GetUsersRequest from "../dtos/requests/GetUsersRequest";
import MessageResponse from "../dtos/responses/MessageResponse";


export default class UserController {

    public static async getById(request: Request<GetUserRequest>, response: Response<OmitPasswordUserResponse>): Promise<Response<OmitPasswordUserResponse>> {
        const { userId } = request.params;

        if (!FieldValidater.isUUID(userId)) {
            throw new Error("INVALID_USER_ID");
        }

        return response.json(await UserService.getById({ userId }));
    }

    public static async create(request: Request<PutUserRequest>, response: Response<OmitPasswordUserResponse>): Promise<Response<OmitPasswordUserResponse>> {
        
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
        
        if (userId ? !FieldValidater.isUUID(userId) : false) {
            throw new Error("INVALID_USER_ID");
        }

        if (tenantId ? !FieldValidater.isUUID(tenantId) : false) {
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

    public static async update(request: Request<PutUserRequest>, response: Response<OmitPasswordUserResponse>): Promise<Response<OmitPasswordUserResponse>> {
        
        const { userId } = request.params;
        const { email, password, name , role , phone , address , createdAt , updatedAt } = request.body;

        if (!FieldValidater.isUUID(userId)) {
            throw new Error("INVALID_USER_ID");
        }

        if (email ? !FieldValidater.isEmail(email) : false) {
            throw new Error("INVALID_EMAIL");
        }

        if (password ? !FieldValidater.isPassword(password) : false) {
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

        return response.json(await UserService.update(request.body));
    }

    public static async delete(request: Request<GetUserRequest>, response: Response<MessageResponse>): Promise<Response<MessageResponse>> {
        const { userId } = request.params;

        if (!FieldValidater.isUUID(userId)) {
            throw new Error("INVALID_USER_ID");
        }

        await UserService.delete({ userId });

        return response.json({ message: "USER_DELETED" });
    }


}