export default class ResetPasswordRequest {
    email?: string;
    password!: string;
    numericToken?: string;
    base64Token?: string;


    constructor(data: any) {
        this.email = data.email;
        this.password = data.password;
        this.numericToken = data.numericToken;
        this.base64Token = data.base64Token;

        // cant have both numericToken and base64Token
        if (this.numericToken && this.base64Token) {
            throw new Error("BOTH_TOKENS_PROVIDED");
        }

        this.validate();
    }

    validate() {

    }
}
