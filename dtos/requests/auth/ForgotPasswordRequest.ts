export default class ForgotPasswordRequest {
    email: string;

    constructor(data: any) {
        this.email = data.email;
        this.validate();
    }

    validate() {
    }
}
