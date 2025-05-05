import SafeUser from "../../../types/SafeUser";

export default interface GetUsersResponse {
    users: SafeUser[];
    total: number;
}