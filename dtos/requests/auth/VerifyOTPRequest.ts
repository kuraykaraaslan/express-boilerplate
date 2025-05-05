import FieldValidater from "../../../utils/FieldValidater";

export default class VerifyOTPRequest {
   otpToken!: string;
   method!: string;

   constructor(data: any) {
      this.otpToken = data.otpToken;
      this.method = data.method;

      this.validate();
   }

   validate() {

   }
}
