import SafeTenantUser from "../../../types/SafeTenantUser";

export default interface GetTenantUsersResponse {
    tenantUsers: SafeTenantUser[];
    total: number;
}