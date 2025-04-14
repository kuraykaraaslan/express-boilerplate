import FieldValidater from "../../../utils/FieldValidater";

import { User } from "@prisma/client";

export default class PutUserRequest {
    userId!: string;
    email!: string;
    name?: string;
    phone?: string;
    address?: string;
    role?: string;

    constructor(data: PutUserRequest) {
        this.email = data.email;
        this.name = data.name;
        this.phone = data.phone;
        this.address = data.address;
        this.role = data.role;

        this.validate();
    }

    validate() {

        if (!FieldValidater.isCUID(this.userId)) {
            throw new Error("INVALID_USER_ID");
        }
        
        if (!FieldValidater.isEmail(this.email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (this.name ? !FieldValidater.sanitizeString(this.name) : false) {
            throw new Error("INVALID_NAME");
        }

        if (this.phone ? !FieldValidater.isPhone(this.phone) : false) {
            throw new Error("INVALID_PHONE");
        }

        if (this.address ? !FieldValidater.sanitizeString(this.address) : false) {
            throw new Error("INVALID_ADDRESS");
        }

        if (this.role ? !FieldValidater.isRole(this.role) : false) {
            throw new Error("INVALID_ROLE");
        }

        return this;
    }
}