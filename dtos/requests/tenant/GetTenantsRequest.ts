export default class GetTenantsRequest {
    skip?: number;
    take?: number;
    search?: string;

    tenantId?: string;

    constructor(data: any) {
        const { skip, take, search, tenantId } = data;
        this.tenantId = tenantId;

        this.skip = skip || 0;
        this.take = take || 10;
        this.search = search;

        this.validate();
    }

    public validate() {
        if (this.skip && typeof this.skip !== "number") {
            this.skip = 0;
        }

        if (this.take && typeof this.take !== "number") {
            this.take = 10;
        }
        
        if (this.search && typeof this.search !== "string") {
            throw new Error("INVALID_SEARCH");
        }

        return this;
    }

}

