import { Request as R} from "express";

interface Request extends R {


    user?: any;
    body: any;


    requestId?: string;

    needAuth?: boolean;
    needAdmin?: boolean;
    
    
}

export default Request;
