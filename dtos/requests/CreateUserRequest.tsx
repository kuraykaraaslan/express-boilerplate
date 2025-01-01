import { User } from "@prisma/client";
import FieldValidater from "@/utils/FieldValidater";

export default interface CreateUserRequest {
    email: string;
    password: string;
    name?: string;
}