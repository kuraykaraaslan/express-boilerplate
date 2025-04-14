import FieldValidater from "../../../utils/FieldValidater";

export default class GetUserRequest {
    userId!: string;

    constructor(data: any) {
        this.userId = data.userId;

        this.validate();
    }

    validate() {
        if (!FieldValidater.isCUID(this.userId)) {
            throw new Error("INVALID_USER_ID");
        }

        return this;
    }

}
