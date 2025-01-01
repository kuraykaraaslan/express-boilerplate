import OmitPasswordUserResponse from "./OmitPasswordUserResponse";
import { UserSession } from "@prisma/client";

export default interface UserSessionResponse {
    user: OmitPasswordUserResponse;
    session: UserSession;
}