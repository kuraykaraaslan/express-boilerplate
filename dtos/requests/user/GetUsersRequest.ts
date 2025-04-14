import FieldValidater from "../../../utils/FieldValidater";

export default class GetUsersRequest {
    skip?: number;
    take?: number;
    userId?: string;
    search?: string;

    constructor(data: any) {
        this.skip = data.skip;
        this.take = data.take;
        this.userId = data.userId;
        this.search = data.search;

        this.validate();
    }

    validate() {
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

