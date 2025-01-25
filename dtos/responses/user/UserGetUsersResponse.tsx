import OmitPasswordUserResponse from "../../../types/UserOmit";

export default interface GetUsersResponse {
    users: OmitPasswordUserResponse[];
    total: number;
}