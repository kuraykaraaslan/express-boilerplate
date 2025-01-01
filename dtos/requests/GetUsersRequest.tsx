export default interface GetUsersDTO {
    skip?: number;
    take?: number;
    userId?: string;
    tenantId?: string;
    search?: string;
}

