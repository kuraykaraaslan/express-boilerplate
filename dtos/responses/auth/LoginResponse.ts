import AuthUserResponse from "../../../types/UserOmit";
import AuthUserSessionResponse from "../../../types/UserSessionOmit";

export default interface AuthResponse {
    user: AuthUserResponse;
    accessToken?: string;
    refreshToken?: string;
}