import UserOmit from "@/types/UserOmit";

export default interface GetUsersResponse {
    users: UserOmit[];
    total: number;
}