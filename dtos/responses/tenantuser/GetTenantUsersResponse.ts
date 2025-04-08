import TenantUserOmit from "@/types/TenantUserOmit";

export default interface GetTenantUsersResponse {
    tenantUsers: TenantUserOmit[];
    total: number;
}