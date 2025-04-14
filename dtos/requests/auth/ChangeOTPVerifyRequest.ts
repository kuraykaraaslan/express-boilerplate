import FieldValidater from "../../../utils/FieldValidater";

export default class ChangeOTPVerifyRequest {
    otpEnabled!: boolean;
    otpStatusChangeToken!: string;

    constructor(data: any) {
        this.otpEnabled = data.otpEnabled;
        this.otpStatusChangeToken = data.otpStatusChangeToken;

        this.validate();
    }

    validate() {
        if (!FieldValidater.isBoolean(this.otpEnabled)) {
            throw new Error("OTP_ENABLED_INVALID");
        }

        if (!FieldValidater.isVerificationToken(this.otpStatusChangeToken)) {
            throw new Error("OTP_STATUS_CHANGE_TOKEN_INVALID");
        }
    }
}