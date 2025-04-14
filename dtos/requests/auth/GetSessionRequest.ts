import FieldValidater from "../../../utils/FieldValidater";



export default class GetSessionRequest {
   accessToken!: string;

   constructor(data: any) {
      this.accessToken = data.accessToken;

      this.validate();
   }

   validate() {
      if (!FieldValidater.isAccessToken(this.accessToken)) {
         throw new Error("INVALID_SESSION_TOKEN");
      }
   }

   static fromJson(json: any): GetSessionRequest {
      return new GetSessionRequest(json.accessToken);
   }
}
 