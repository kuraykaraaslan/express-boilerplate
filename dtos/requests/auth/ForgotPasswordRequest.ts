import FieldValidater from "../../../utils/FieldValidater";

export default class ForgotPasswordRequest {
    email!: string;

    constructor(data: any) {
        this.email = data.email;

        this.validate();
    }

    validate() {
        if (!FieldValidater.isEmail(this.email)) {
            throw new Error("INVALID_EMAIL");
        }
    }
}
