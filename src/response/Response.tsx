import { Response as R } from "express";

class Response {
  status: (status: number) => Response;
  json: (json: any) => void;

  constructor() {
    this.status = (status: number) => this;
    this.json = (json: any) => {};
  }
}

// @ts-expect-error : Changing the type of the class
interface Response extends R {}

export default Response;
