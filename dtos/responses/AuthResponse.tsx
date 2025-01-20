import OmitPasswordUserResponse from "./OmitPasswordUserResponse";
import OmitOTPFieldsUserSessionResponse from "./OmitOTPFieldsUserSessionResponse";

export default interface AuthResponse {
    user: OmitPasswordUserResponse;
    userSession: OmitOTPFieldsUserSessionResponse;
}