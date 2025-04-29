import AuthErrors from "../../../errors/AuthErrors";
import FieldValidater from "../../../utils/FieldValidater";



export default class GetSessionRequest {
   accessToken!: string;

   constructor(data: any) {
      this.accessToken = data.accessToken;

      console.log('GetSessionRequest data:', data);

   }


   static fromJson(json: any): GetSessionRequest {
      return new GetSessionRequest(json.accessToken);
   }
}
 