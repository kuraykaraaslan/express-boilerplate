import FieldValidater from "../../../utils/FieldValidater";
export default class LoginRequest {
    email!: string;
    password!: string;

    constructor(data: any) {
        this.email = data.email;
        this.password = data.password;

        this.validate();
    }

    validate() {
        if (!FieldValidater.isEmail(this.email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(this.password)) {
            throw new Error("INVALID_PASSWORD");
        }
    }
}