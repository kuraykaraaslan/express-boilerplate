/**
 * User Router Module
 * 
 * This module provides endpoints to manage user operations such as creation and retrieval.
 * It uses the UserService to interact with the database and perform necessary actions.
 */
import { Router, Request, Response } from "express";

// DTOs
import GetUsersRequest from "../../dtos/requests/GetUsersRequest";
import GetUsersResponse from "../../dtos/responses/GetUsersResponse";
import PutUserRequest from "../../dtos/requests/PutUserRequest";
import OmitPasswordUserResponse from "../../dtos/responses/OmitPasswordUserResponse";
import GetUserRequest from "../../dtos/requests/GetUserRequest";

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";
import UserController from "../../controllers/UserController";
import MessageResponse from "@/dtos/responses/MessageResponse";


const userRouter = Router();

userRouter.use(AuthMiddleware("User"));


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
userRouter.post("/", async (request: Request<PutUserRequest>, response: Response<OmitPasswordUserResponse>) : Promise<Response<OmitPasswordUserResponse>> => {
    // Create a new user in the database
    return await UserController.create(request, response);
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
userRouter.get("/", async (request: Request<GetUsersRequest>, response: Response<GetUsersResponse>) : Promise<Response<GetUsersResponse>> => {

    return await UserController.get(request, response);
    
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
userRouter.get("/:userId", async (request: Request<GetUserRequest>, response: Response<OmitPasswordUserResponse>) : Promise<Response<OmitPasswordUserResponse>> => {
    
    return await UserController.getById(request, response);
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
userRouter.put("/:userId", async (request: Request<PutUserRequest>, response: Response<OmitPasswordUserResponse>) : Promise<Response<OmitPasswordUserResponse>> => {
    // Respond with the updated user details
    return await UserController.update(request, response);
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
userRouter.delete("/:userId", async (request: Request<GetUserRequest>, response: Response) : Promise<Response<MessageResponse>> => {
    // Delete the user by ID
    return await UserController.delete(request, response);
});



export default userRouter;
