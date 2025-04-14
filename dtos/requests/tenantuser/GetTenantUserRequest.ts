import FieldValidater from "../../../utils/FieldValidater";

export default class GetTenantUserRequest {
    tenantUserId?: string;
    userId?: string;
    tenantId?: string;

    constructor(data: any) {
        this.tenantUserId = data.tenantUserId;
        this.userId = data.userId;
        this.tenantId = data.tenantId;
        this.validate();
    }

    validate(): boolean {

        //TODO: Add validation logic for tenantUserId, userId, and tenantId
        return true;
    }
}
