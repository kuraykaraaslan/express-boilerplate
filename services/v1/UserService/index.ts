import prisma from "../../../libs/prisma";
import { User } from "@prisma/client";

// Libraries
import bcrypt from "bcrypt";

// Utils
import FieldValidater from "../../../utils/FieldValidater";


// Omit
import UserOmit from "@/types/UserOmit";

// DTOs
import CreateUserRequest from "./../../../dtos/requests/user/CreateUserRequest";
import AuthUserResponse from "./../../../types/UserOmit";
import GetUsersRequest from "./../../../dtos/requests/user/GetUsersRequest";
import GetUsersResponse from "./../../../dtos/responses/user/GetUsersResponse";
import PutUserRequest from "./../../../dtos/requests/user/PutUserRequest";
import GetUserRequest from "./../../../dtos/requests/user/GetUserRequest";

export default class UserService {

    /**
     * Error Messages
     * These are the error messages that can be thrown by the service.
     * TODO: Add more error messages as needed.
     */
    static INVALID_EMAIL = "INVALID_EMAIL";
    static INVALID_PASSWORD_FORMAT = "INVALID_PASSWORD_FORMAT";
    static USER_NOT_FOUND = "USER_NOT_FOUND";
    static EMAIL_ALREADY_EXISTS = "EMAIL_ALREADY_EXISTS";

    
    /**
     * Omit sensitive fields from the user object.
     * @param user - The user object.
     * @returns The user object without the password, resetToken, and resetTokenExpiry.
     */
    static omitSensitiveFields(user: User): AuthUserResponse {
        const omitted : AuthUserResponse = {
            userId: user.userId,
            email: user.email,
            phone: user.phone,
            name: user.name,
            userRole: user.userRole,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            profilePicture: user.profilePicture,
            otpEnabled: user.otpEnabled,
            otpEnabledAt: user.otpEnabledAt,
        };

        return omitted;

    }


    /**
     * Creates a new user in the database after validating input and hashing the password.
     * @param data - Partial user data to create the user.
     * @returns The created user without sensitive fields like password.
     */
    static async create(data: CreateUserRequest): Promise<AuthUserResponse> {

        const { email, password, name } = data;

        // Validate email and password
        if (!email || !FieldValidater.isEmail(email)) {
            throw new Error(this.INVALID_EMAIL);
        }

        if (!password || !FieldValidater.isPassword(password)) {
            throw new Error(this.INVALID_PASSWORD_FORMAT);
        }

        // Check if the email is already in use
        const existingUser = await prisma.user.findUnique({
            where: { email },
        }).then((user) => {
            throw new Error(this.EMAIL_ALREADY_EXISTS);
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
        return this.omitSensitiveFields(user);

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
    static async getAll(data: GetUsersRequest): Promise<GetUsersResponse> {

        const { skip, take, search , userId } = data;

        const queryOptions = {
            skip,
            take,
            where: {
                userId: userId ? userId : undefined,
                OR: [
                    { email: { contains: search ? search : '' } },
                    { name: { contains: search ? search : '' } },
                ],
            }
        };

        // Get all users
        const [users, total] = await prisma.$transaction([
            prisma.user.findMany(queryOptions),
            prisma.user.count({ where: queryOptions.where }),
        ]);

        // Exclude sensitive fields from the response
        const usersWithoutPassword = users.map((user) => this.omitSensitiveFields(user));

        return { users: usersWithoutPassword, total };
    }

    /**
     * Retrieves a user from the database by ID.
     * @param userId - The user ID to retrieve.
     * @returns The user details.
     */
    static async getById(data: GetUserRequest): Promise<UserOmit> {

        const { userId } = data;
        
        // Get the user by ID
        const user = await prisma.user.findUnique({
            where: { userId },
        });

        if (!user) {
            throw new Error(this.USER_NOT_FOUND);
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
    static async update(data: PutUserRequest): Promise<UserOmit> {

        const { userId } = data;

        if (!userId) {
            throw new Error(this.USER_NOT_FOUND);
        }

        // Get the user by ID
        const user = await prisma.user.findUnique({
            where: { userId },
        });

        if (!user) {
            throw new Error(this.USER_NOT_FOUND);
        }

        // Update the user in the database
        const updatedUser = await prisma.user.update({
            where: { userId },
            data,
        });

        // Exclude sensitive fields from the response
        return this.omitSensitiveFields(updatedUser);

    }

    /**
     * Deletes a user from the database by ID.
     * @param userId - The user ID to delete.
     * @returns The deleted user details.
     */
    static async delete(data: GetUsersRequest): Promise<void> {

        const { userId } = data;

        // Get the user by ID
        const user = await prisma.user.findUnique({
            where: { userId },
        });

        if (!user) {
            throw new Error(this.USER_NOT_FOUND);
        }

        // Delete the user from the database
        await prisma.user.delete({
            where: { userId },
        });

        return;
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






