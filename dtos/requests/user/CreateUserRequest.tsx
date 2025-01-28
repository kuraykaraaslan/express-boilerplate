import FieldValidater from "@/utils/FieldValidater";

import { User } from "@prisma/client";
export default class CreateUserRequest {
    email!: string;
    password!: string;
    name?: string;
}