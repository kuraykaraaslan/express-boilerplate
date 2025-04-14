import FieldValidater from "../../../utils/FieldValidater";

export default class VerifyOTPRequest {
   accessToken!: string;
   otpToken!: string;

   constructor(data: any) {
      this.accessToken = data.accessToken;
      this.otpToken = data.otpToken;

      this.validate();
   }

   validate() {
      if (!FieldValidater.isAccessToken(this.accessToken)) {
         throw new Error("Invalid accessToken.");
      }

      if (!FieldValidater.isVerificationToken(this.otpToken)) {
         throw new Error("Invalid OTP.");
      }
   }
}
