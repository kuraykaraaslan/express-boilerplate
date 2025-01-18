import { User } from "@prisma/client";
export default class CreateUserRequest {
    email!: string;
    password!: string;
    name?: string;
}