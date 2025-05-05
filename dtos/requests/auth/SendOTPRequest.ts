export default class SendOTPRequest {
   method!: string;

   constructor(data: any) {
      this.method = data.method;

      this.validate();
   }

   validate() {

   }
}
