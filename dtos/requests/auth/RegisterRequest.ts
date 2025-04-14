import FieldValidater from "../../../utils/FieldValidater";

export default class RegisterRequest {
    email!: string;
    password!: string;
    phone?: string;
    name?: string;    

    constructor(data: any) {
        this.email = data.email;
        this.password = data.password;
        this.phone = data.phone;
        this.name = data.name;

        this.validate();
    }

    validate() {
        if (!FieldValidater.isEmail(this.email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(this.password)) {
            throw new Error("INVALID_PASSWORD");
        }

        if (this.phone && !FieldValidater.isPhone(this.phone)) {
            throw new Error("INVALID_PHONE");
        }

        if (this.name && !FieldValidater.isName(this.name)) {
            throw new Error("INVALID_NAME");
        }
    }
}