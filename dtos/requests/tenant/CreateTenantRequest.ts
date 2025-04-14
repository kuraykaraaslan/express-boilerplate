import FieldValidater from "../../../utils/FieldValidater";


import { TenantStatus } from "@prisma/client";
export default class CreateTenantRequest {

    domain!: string;
    name!: string;
    tenantStatus?: TenantStatus;

    constructor(data: any) {
        const { name, domain, tenantStatus } = data;

        this.name = name;
        this.domain = domain;
        this.tenantStatus = tenantStatus;

        this.validate();

    }

    public validate() {
        if (!FieldValidater.isName(this.name)) {
            throw new Error("INVALID_NAME");
        }

        if (!FieldValidater.isDomain(this.domain)) {
            throw new Error("INVALID_DOMAIN");
        }

        if (this.tenantStatus && !FieldValidater.isTenantStatus(this.tenantStatus)) {
            throw new Error("INVALID_TENANT_STATUS");
        }

        return this;
    }

}