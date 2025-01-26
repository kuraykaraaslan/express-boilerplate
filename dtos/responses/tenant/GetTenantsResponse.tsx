import TenantOmit from "../../../types/TenantOmit";
import UserOmit from "../../../types/UserOmit";

export default interface GetTenantsResponse {
    tenants: TenantOmit[];
    total: number;
}