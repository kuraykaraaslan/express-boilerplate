import FieldValidater from "@/utils/FieldValidater";

export default class GetTenantUsersRequest {
    skip?: number;
    take?: number;
    userId?: string;
    search?: string;
    tenantId?: string;
}

