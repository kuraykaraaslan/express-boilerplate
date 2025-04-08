import UserOmit from "./UserOmit";
import UserSessionOmit from "./UserSessionOmit";
import { TenantUser } from "@prisma/client";
import { Request } from "express";

declare module "express-serve-static-core" {
    interface Request {
        user?: UserOmit; // Replace 'User' with the actual type of your user object
        userSession?: UserSessionOmit; // Replace 'UserSession' with the actual type of your user session object

        //Tenancy Related
        tenant?: Tenant;
        tenantUser?: TenantUserOmit;
    }
    
}
