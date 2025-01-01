import OmitPasswordUserResponse from "./OmitPasswordUserResponse";

export default interface GetUsersResponse {
    users: OmitPasswordUserResponse[];
    total: number;
}