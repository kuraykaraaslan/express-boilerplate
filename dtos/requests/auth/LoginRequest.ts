export default class LoginRequest {
    email!: string;
    password!: string;

    constructor(data: any) {
        this.email = data.email;
        this.password = data.password;
    }

}