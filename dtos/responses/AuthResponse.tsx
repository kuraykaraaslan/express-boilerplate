import AuthUserResponse from "./AuthUserResponse";
import AuthUserSessionResponse from "./AuthUserSessionResponse";

export default interface AuthResponse {
    user: AuthUserResponse;
    userSession: AuthUserSessionResponse;
}