import { TenantStatus, User } from "@prisma/client";
import FieldValidater from "../../../utils/FieldValidater";



export default class PutTenantRequest {
    tenantId!: string;
    domain!: string;
    name!: string;
    tenantStatus!: TenantStatus;

    constructor(data: any) {
        const { tenantId, domain, name, tenantStatus } = data;

        this.tenantId = tenantId;
        this.domain = domain;
        this.name = name;
        this.tenantStatus = tenantStatus;

        this.validate();
    }

    public validate() {
        if (!FieldValidater.isCUID(this.tenantId)) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (!FieldValidater.isDomain(this.domain)) {
            throw new Error("INVALID_DOMAIN");
        }

        if (!FieldValidater.isName(this.name)) {
            throw new Error("INVALID_NAME");
        }

        if (!FieldValidater.isTenantStatus(this.tenantStatus)) {
            throw new Error("INVALID_TENANT_STATUS");
        }

        return this;
    }
}