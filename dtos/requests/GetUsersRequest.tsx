export default interface GetUsersRequest {
    skip?: number;
    take?: number;
    userId?: string;
    tenantId?: string;
    search?: string;
}

