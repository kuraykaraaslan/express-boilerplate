import FieldValidater from "../../../utils/FieldValidater";

export default class GetSessionRequest {
   sessionToken!: string;

   constructor(data: any) {
      this.sessionToken = data.sessionToken;

      this.validate();
   }

   validate() {
      if (!FieldValidater.isSessionToken(this.sessionToken)) {
         throw new Error("INVALID_SESSION_TOKEN");
      }
   }

   static fromJson(json: any): GetSessionRequest {
      return new GetSessionRequest(json.sessionToken);
   }
}
