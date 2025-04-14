import FieldValidater from "../../../utils/FieldValidater";



export default class SendOTPRequest {
   accessToken!: string;
   method!: string;
   allowedMethods = ["sms", "email"];

   constructor(data: any) {
      this.accessToken = data.accessToken;
      this.method = data.method;

      this.validate();
   }

   validate() {
      if (!FieldValidater.isAccessToken(this.accessToken)) {
         throw new Error("Invalid accessToken.");
      }

      if (!this.allowedMethods.includes(this.method)) {
         throw new Error("Invalid method.");
      }
   }
}
