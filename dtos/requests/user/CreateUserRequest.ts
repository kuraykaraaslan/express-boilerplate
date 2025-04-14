import FieldValidater from "../../../utils/FieldValidater";

import { User } from "@prisma/client";
export default class CreateUserRequest {
    email!: string;
    password!: string;
    name?: string;

    constructor(data: CreateUserRequest) {
        this.email = data.email;
        this.password = data.password;
        this.name = data.name;

        this.validate();
    }

    validate() {
        if (!FieldValidater.isEmail(this.email)) {
            throw new Error("Invalid email address");
        }

        if (!FieldValidater.isPassword(this.password)) {
            throw new Error("Invalid password");
        }

        if (this.name && !FieldValidater.isName(this.name)) {
            throw new Error("Invalid name");
        }
    }
}