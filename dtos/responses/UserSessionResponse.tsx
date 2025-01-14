import OmitPasswordUserResponse from "./OmitPasswordUserResponse";
import OmitOTPFieldsUserSessionResponse from "./OmitOTPFieldsUserSessionResponse";

export default interface UserSessionResponse {
    user: OmitPasswordUserResponse;
    userSession: OmitOTPFieldsUserSessionResponse;
}