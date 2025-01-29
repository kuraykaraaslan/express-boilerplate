import FieldValidater from "../../../utils/FieldValidater";export default class VerifyOTPRequest {
   sessionToken!: string;
   otpToken!: string;

   constructor(data: any) {
      this.sessionToken = data.sessionToken;
      this.otpToken = data.otpToken;

      this.validate();
   }

   validate() {
      if (!FieldValidater.isSessionToken(this.sessionToken)) {
         throw new Error("Invalid sessionToken.");
      }

      if (!FieldValidater.isVerificationToken(this.otpToken)) {
         throw new Error("Invalid OTP.");
      }
   }
}
