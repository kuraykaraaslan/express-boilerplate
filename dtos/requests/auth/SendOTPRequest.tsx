import FieldValidater from "../../../utils/FieldValidater";export default class SendOTPRequest {
   sessionToken!: string;
   method!: string;
   allowedMethods = ["sms", "email"];

   constructor(data: any) {
      this.sessionToken = data.sessionToken;
      this.method = data.method;

      this.validate();
   }

   validate() {
      if (!FieldValidater.isSessionToken(this.sessionToken)) {
         throw new Error("Invalid sessionToken.");
      }

      if (!this.allowedMethods.includes(this.method)) {
         throw new Error("Invalid method.");
      }
   }
}
