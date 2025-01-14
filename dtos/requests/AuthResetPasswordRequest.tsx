export default interface AuthResetPasswordRequest {
    email: string;
    password: string;
    resetToken: string;
}
