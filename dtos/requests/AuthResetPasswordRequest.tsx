export default interface AuthResetPasswordRequest {
    email: string;
    password: string;
    code: string;
}
