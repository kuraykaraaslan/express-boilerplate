import { Response as R } from "express";

class Response {
    //@ts-ignore
    status: (status: number) => Response;
    //@ts-ignore
    json: (json: any) => void;

    constructor() {
        this.status = (status: number) => this;
        this.json = (json: any) => {};
    }
}
// @ts-ignore
interface Response extends R {}

export default Response;
