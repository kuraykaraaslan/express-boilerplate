import { Request as R } from "express";

interface Request extends R {

  requestId?: string;

  // User and Tenant are set by the auth middleware and tenant middleware
  user?: any;
  tenant?: any;
  tenantMember?: any;

  body: any;

}

export default Request;
