import FieldValidater from "../../../utils/FieldValidater";
export default class ChangeOTPStatusRequest {
    otpEnabled!: boolean;

    constructor(otpEnabled: boolean) {
        this.otpEnabled = otpEnabled;

        this.validate();
    }

    validate() {
        if (FieldValidater.isBoolean(this.otpEnabled)) {
            throw new Error("Invalid OTP status.");
        }
    }
}