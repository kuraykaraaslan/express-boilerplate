import FieldValidater from "../../../utils/FieldValidater";



export default class GetTenantRequest {
    tenantId?: string;
    domain?: string;

    constructor(data: any) {
        const { tenantId, domain } = data;

        this.tenantId = tenantId;
        this.domain = domain;

        this.validate();
    }

    public validate() {
        if (this.tenantId && !FieldValidater.isCUID(this.tenantId)) {
            throw new Error("INVALID_TENANT_ID");
        }

        if (this.domain && !FieldValidater.isDomain(this.domain)) {
            throw new Error("INVALID_DOMAIN");
        }

        if (this.tenantId && this.domain) {
            throw new Error("INVALID_TENANT_ID_AND_DOMAIN");
        }        

        return this;
    }
}
