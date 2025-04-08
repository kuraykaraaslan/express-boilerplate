import AuthUserResponse from "@/types/UserOmit";
import AuthUserSessionResponse from "@/types/UserSessionOmit";

export default interface AuthResponse {
    user: AuthUserResponse;
    userSession: AuthUserSessionResponse;
}