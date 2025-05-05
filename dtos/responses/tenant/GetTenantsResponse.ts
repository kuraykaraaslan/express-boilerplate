import SafeTenant from "../../../types/SafeTenant";

export default interface GetTenantsResponse {
    tenants: SafeTenant[];
    total: number;
}