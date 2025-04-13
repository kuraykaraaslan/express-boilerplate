export default class GetTenantUsersRequest {
    skip?: number;
    take?: number;
    userId?: string;
    search?: string;
    tenantId?: string;
    tenantUserId?: string;

    constructor(data: any) {
        this.skip = data.skip;
        this.take = data.take;
        this.userId = data.userId;
        this.search = data.search;
        this.tenantId = data.tenantId;
        this.tenantUserId = data.tenantUserId;
        this.validate();

    }

    public validate(): boolean {
        //TODO: Add validation logic for skip, take, userId, search, and tenantId
        return true;
    }
}

