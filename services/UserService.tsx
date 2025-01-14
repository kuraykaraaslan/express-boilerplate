import prisma from "../libs/prisma";
import { User } from "@prisma/client";
import bcrypt from "bcrypt";
import FieldValidater from "../utils/FieldValidater";

// DTOs
import CreateUserRequest from "../dtos/requests/CreateUserRequest";
import OmitPasswordUserResponse from "../dtos/responses/OmitPasswordUserResponse";
import GetUsersRequest from "@/dtos/requests/GetUsersRequest";
import GetUsersResponse from "../dtos/responses/GetUsersResponse";
import PutUserRequest from "@/dtos/requests/PutUserRequest";

export default class UserService {

    /**
     * Omit sensitive fields from the user object.
     * @param user - The user object.
     * @returns The user object without the password, resetToken, and resetTokenExpiry.
     */
    static omitSensitiveFields(user: User): OmitPasswordUserResponse {
        const { password, resetToken, resetTokenExpiry, ...userWithoutPassword } = user;
        return userWithoutPassword;
    }


    /**
     * Creates a new user in the database after validating input and hashing the password.
     * @param data - Partial user data to create the user.
     * @returns The created user without sensitive fields like password.
     */
    static async create(data: CreateUserRequest): Promise<OmitPasswordUserResponse> {

        const { email, password, name } = data;

        // Validate email and password
        if (!email || !FieldValidater.isEmail(email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!password || !FieldValidater.isPassword(password)) {
            throw new Error("INVALID_PASSWORD_FORMAT");
        }

        // Check if the email is already in use
        const existingUser = await prisma.user.findUnique({
            where: { email },
        }).then((user) => {
            throw new Error("Email is already in use.");
        });

        // Hash the password before saving
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create the user in the database
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword, // Store the hashed password
                name,
            },
        });

        // Exclude sensitive fields from the response
        const { password: _, ...userWithoutPassword } = user;

        return userWithoutPassword;

    }

    /**
     * Retrieves all users from the database.
     * @param skip - The number of records to skip.
     * @param take - The number of records to take.
     * @param userId - The user ID to filter by.
     * @param tenantId - The tenant ID to filter by.
     * @param search - The search term to filter by.
     * @returns A list of users.
     */
    static async get(data: GetUsersRequest): Promise<GetUsersResponse> {

        const { skip, take, userId, tenantId, search } = data;

        const queryOptions = {
            skip,
            take,
            where: {
                userId : userId ? userId : search,
                tenantId : tenantId ? tenantId : search,
                OR: [
                    { email: { contains: search } },
                    { name: { contains: search } },
                ],
            }
        };

        // Get all users
        const [users, total] = await prisma.$transaction([
            prisma.user.findMany(queryOptions),
            prisma.user.count({ where: queryOptions.where }),
        ]);

        // Exclude sensitive fields from the response
        const usersWithoutPassword = users.map(({ password: _, ...user }) => user);

        return { users: usersWithoutPassword, total };
    }

    /**
     * Retrieves a user from the database by ID.
     * @param userId - The user ID to retrieve.
     * @returns The user details.
     */
    static async getById(data: GetUsersRequest): Promise<OmitPasswordUserResponse> {

        const { userId } = data;
        
        // Get the user by ID
        const user = await prisma.user.findUnique({
            where: { userId },
        });

        if (!user) {
            throw new Error("USER_NOT_FOUND");
        }

        // Exclude sensitive fields from the response
        const { password: _, ...userWithoutPassword } = user;

        return userWithoutPassword;
    }

    /**
     * Updates a user in the database by ID.
     * @param userId - The user ID to update.
     * @param data - Partial user data to update.
     * @returns The updated user details.
     */
    static async update(data: PutUserRequest): Promise<OmitPasswordUserResponse> {

        const { userId } = data;

        if (!userId) {
            throw new Error("USER_ID_REQUIRED");
        }

        // Get the user by ID
        const user = await prisma.user.findUnique({
            where: { userId },
        });

        if (!user) {
            throw new Error("USER_NOT_FOUND");
        }

        // Update the user in the database
        const updatedUser = await prisma.user.update({
            where: { userId },
            data,
        });

        // Exclude sensitive fields from the response
        const { password: _, ...userWithoutPassword } = updatedUser;

        return userWithoutPassword;

    }

    /**
     * Deletes a user from the database by ID.
     * @param userId - The user ID to delete.
     * @returns The deleted user details.
     */
    static async delete(data: GetUsersRequest): Promise<OmitPasswordUserResponse> {

        const { userId } = data;

        // Get the user by ID
        const user = await prisma.user.findUnique({
            where: { userId },
        });

        if (!user) {
            throw new Error("USER_NOT_FOUND");
        }

        // Delete the user from the database
        await prisma.user.delete({
            where: { userId },
        });

        // Exclude sensitive fields from the response
        const { password: _, ...userWithoutPassword } = user;

        return userWithoutPassword;
    }


    /**
     * Retrieves a user from the database by email.
     * @param email - The email to retrieve.
     * @returns The user details.
     */
    static async getByEmail(email: string): Promise<User | null> {
        return prisma.user.findUnique({
            where: { email },
        });
    }

}






