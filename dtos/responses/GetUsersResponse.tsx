import OmitPasswordUserResponse from "./AuthUserResponse";

export default interface GetUsersResponse {
    users: OmitPasswordUserResponse[];
    total: number;
}