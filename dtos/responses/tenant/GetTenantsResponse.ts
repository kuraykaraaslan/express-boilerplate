import TenantOmit from "@/types/TenantOmit";

export default interface GetTenantsResponse {
    tenants: TenantOmit[];
    total: number;
}