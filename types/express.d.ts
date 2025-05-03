import UserOmit from "./UserOmit";
import UserSessionOmit from "./UserSessionOmit";
import { TenantUser } from "@prisma/client";
import { Request } from "express";

declare module "express-serve-static-core" {
    interface Request {
        user?: UserOmit;
        tenantUser?: TenantUserOmit;

        userSession?: UserSessionOmit;

    }

}
