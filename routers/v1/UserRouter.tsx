/**
 * User Router Module
 * 
 * This module provides endpoints to manage user operations such as creation and retrieval.
 * It uses the UserService to interact with the database and perform necessary actions.
 */
import UserService from "../../services/UserService";
import { Router, Request, Response } from "express";

// DTOs
import GetUsersRequest from "../../dtos/requests/GetUsersRequest";
import GetUsersResponse from "../../dtos/responses/GetUsersResponse";
import PutUserRequest from "../../dtos/requests/PutUserRequest";
import OmitPasswordUserResponse from "../../dtos/responses/OmitPasswordUserResponse";
import GetUserRequest from "../../dtos/requests/GetUserRequest";

// Middlewares
import AuthMiddleware from "../../middlewares/AuthMiddleware";


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
userRouter.post("/", async (req : Request<PutUserRequest>, res : Response<OmitPasswordUserResponse>) => {
    // Create a new user in the database
    const user = await UserService.create(req.body);
    res.status(201).json(user);
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
userRouter.get("/", async (req: Request<GetUsersRequest>, res: Response<GetUsersResponse>) => {

    const { skip = "0", take = "10", userId, tenantId, search } = req.query;

    // Prepare query options with default values and type casting
    const queryOptions = {
        skip: parseInt(skip as string),
        take: parseInt(take as string),
        userId: userId as string,
        tenantId: tenantId as string,
        search: search as string,
    };

    // Fetch users and total count based on query options
    const { users, total } = await UserService.get(queryOptions);

    // Respond with the list of users and total count
    res.json({ users, total });
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
userRouter.get("/:userId", async (req : Request<GetUserRequest>, res : Response<OmitPasswordUserResponse>) => {
    // Retrieve the user by ID
    const user = await UserService.getById({ userId: req.params.userId });
    // Respond with the user details
    res.json(user);
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
userRouter.put("/:userId", async (req : Request<PutUserRequest>, res : Response<OmitPasswordUserResponse>) => {
    // Update the user by ID
    const user = await UserService.update({ userId: req.params.userId, ...req.body });
    // Respond with the updated user details
    res.json(user);
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
userRouter.delete("/:userId", async (req : Request<GetUserRequest>, res : Response) => {
    // Delete the user by ID
    const user = await UserService.delete({ userId: req.params.userId });

    if (!user) {
        // Respond with 404 if user is not found
        return res.status(404).json({ error: "User not found." });
    }

    // Respond with 204 if user is successfully deleted
    res.sendStatus(204);
});



export default userRouter;
