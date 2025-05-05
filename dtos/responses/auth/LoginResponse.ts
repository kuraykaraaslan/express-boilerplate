import AuthUserResponse from "../../../types/SafeUser";

export default interface AuthResponse {
    user?: AuthUserResponse;
    accessToken?: string;
    refreshToken?: string;
}