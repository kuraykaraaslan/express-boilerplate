import FieldValidater from "../../../utils/FieldValidater";

export default class ResetPasswordRequest {
    email!: string;
    password!: string;
    resetToken!: string;

    constructor(data: any) {
        this.email = data.email;
        this.password = data.password;
        this.resetToken = data.resetToken;

        this.validate();
    }

    validate() {
        if (!FieldValidater.isEmail(this.email)) {
            throw new Error("INVALID_EMAIL");
        }

        if (!FieldValidater.isPassword(this.password)) {
            throw new Error("INVALID_PASSWORD");
        }

        if (!FieldValidater.isVerificationToken(this.resetToken)) {
            throw new Error("INVALID_RESET_TOKEN");
        }
    }
}
