/**
 * User Router Module
 * 
 * This module provides endpoints to manage user operations such as creation and retrieval.
 * It uses the UserService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// Services
import UserService from "../../../services/v1/UserService";

// DTOs
import GetUsersRequest from "../../../dtos/requests/user/GetUsersRequest";
import GetUsersResponse from "../../../dtos/responses/user/GetUsersResponse";
import PutUserRequest from "../../../dtos/requests/user/PutUserRequest";
import UserOmit from "../../../types/UserOmit";
import GetUserRequest from "../../../dtos/requests/user/GetUserRequest";

// Middlewares
import AuthMiddleware from "../../../middlewares/v1/authMiddleware";

// Utils
import FieldValidater from "../../../utils/FieldValidater";
import CreateUserRequest from "../../../dtos/requests/user/CreateUserRequest";


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
userRouter.post("/", async (request: Request, response: Response<UserOmit>): Promise<Response<UserOmit>> => {
    const data = new CreateUserRequest(request.body);
    const user = await UserService.create(data);
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
userRouter.get("/", async (request: Request, response: Response<GetUsersResponse>): Promise<Response<GetUsersResponse>> => {

    const data = new GetUsersRequest(request.query);
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
userRouter.get("/:userId", async (request: Request, response: Response<UserOmit>): Promise<Response<UserOmit>> => {

    const data = new GetUserRequest(request.params);
    const user = await UserService.getById(data);

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
userRouter.put("/:userId", async (request: Request, response: Response<UserOmit>): Promise<Response<UserOmit>> => {

    const data = new PutUserRequest(request.body);
    const userId = request.params.userId;

    if (userId !== data.userId) {
        throw new Error("INVALID_USER_ID");
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
userRouter.delete("/:userId", async (request: Request, response: Response): Promise<Response<UserOmit>> => {
  
    const data = new GetUserRequest(request.params);
    const userId = request.params.userId;
    
    if (userId !== data.userId) {
        throw new Error("INVALID_USER_ID");
    }
  
    const deletedUser = await UserService.delete(data);

    return response.json(deletedUser);
});



export default userRouter;
