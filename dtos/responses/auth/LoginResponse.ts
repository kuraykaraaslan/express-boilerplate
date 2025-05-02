import AuthUserResponse from "../../../types/UserOmit";

export default interface AuthResponse {
    user?: AuthUserResponse;
    accessToken?: string;
    refreshToken?: string;
}