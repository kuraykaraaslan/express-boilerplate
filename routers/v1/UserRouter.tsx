/**
 * User Router Module
 * 
 * This module provides endpoints to manage user operations such as creation and retrieval.
 * It uses the UserService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// Services
import UserService from "../../services/UserService";

// DTOs
import GetUsersRequest from "../../dtos/requests/user/GetUsersRequest";
import GetUsersResponse from "../../dtos/responses/user/GetUsersResponse";
import PutUserRequest from "../../dtos/requests/user/PutUserRequest";
import UserOmit from "../../types/UserOmit";
import GetUserRequest from "../../dtos/requests/user/GetUserRequest";
import MessageResponse from "../../dtos/responses/MessageResponse";

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";

// Utils
import FieldValidater from "@/utils/FieldValidater";


const userRouter = Router();

userRouter.use(AuthMiddleware("ADMIN"));


/**
 * POST /
 * Create a new user.
 * 
 * Request Body:
 * - email (string): The email address of the new user (required).
 * - password (string): The password for the new user (required).
 * 
 * Response:
 * - 201: User successfully created with details of the created user.
 * - 400: Validation error if email or password is missing.
 */
userRouter.post("/", async (request: Request<PutUserRequest>, response: Response<UserOmit>): Promise<Response<UserOmit>> => {
    // Create a new user in the database

    const { email, password, name, role, phone, address } = request.body;

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

    const user = await UserService.create(request.body);

    return response.status(201).json(user);
});

/**
 * GET /
 * Retrieve users based on query parameters.
 * 
 * Query Parameters:
 * - skip (string, optional): Number of users to skip for pagination (default: 0).
 * - take (string, optional): Number of users to retrieve for pagination (default: 10).
 * - userId (string, optional): ID of a specific user to retrieve.
 * - tenantId (string, optional): Tenant ID to filter users.
 * - search (string, optional): Search term to filter users.
 * 
 * Response:
 * - 200: List of users and total count if no specific user is requested.
 * - 200: Single user details if userId is provided and found.
 * - 404: User not found if userId is provided and no matching user exists.
 */
userRouter.get("/", async (request: Request<GetUsersRequest>, response: Response<GetUsersResponse>): Promise<Response<GetUsersResponse>> => {

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

    const { users, total } = await UserService.getAll(data);
    return response.json({ users, total });

});

/**
 * GET /:userId
 * Retrieve a user by ID.
 * 
 * Path Parameters:
 * - userId (string): The ID of the user to retrieve.
 * 
 * Response:
 * - 200: User details if found.
 * - 404: User not found if no matching user exists.
 */
userRouter.get("/:userId", async (request: Request<GetUserRequest>, response: Response<UserOmit>): Promise<Response<UserOmit>> => {

    const { userId } = request.params;

    if (!FieldValidater.isCUID(userId)) {
        throw new Error("INVALID_USER_ID");
    }

    const user = await UserService.getById({ userId });

    if (!user) {
        throw new Error("USER_NOT_FOUND");
    }

    return response.json(user);
});

/**
 * PUT /:userId
 * Update a user by ID.
 * 
 * Path Parameters:
 * - userId (string): The ID of the user to update.
 * 
 * Request Body:
 * - email (string): The new email address of the user.
 * - password (string): The new password for the user.
 * 
 * Response:
 * - 200: User successfully updated with details of the updated user.
 * - 400: Validation error if email or password is missing.
 * - 404: User not found if no matching user exists.
 */
userRouter.put("/:userId", async (request: Request<PutUserRequest>, response: Response<UserOmit>): Promise<Response<UserOmit>> => {

    const { userId, email, name, role, phone, address } = request.body;

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
    
    const user = await UserService.update(request.body);

    return response.json(user);
});

/**
 * DELETE /:userId
 * Delete a user by ID.
 * 
 * Path Parameters:
 * - userId (string): The ID of the user to delete.
 * 
 * Response:
 * - 204: User successfully deleted.
 * - 404: User not found if no matching user exists.
 */
userRouter.delete("/:userId", async (request: Request<GetUserRequest>, response: Response): Promise<Response<UserOmit>> => {
  
    const { userId } = request.params;

    if (!FieldValidater.isCUID(userId)) {
        throw new Error("INVALID_USER_ID");
    }
  
    const deletedUser = await UserService.delete({ userId });

    return response.json(deletedUser);
});



export default userRouter;
