import { SafeUser } from "../../user/types/SafeUser";
import { SafeUserSession } from "../../auth/types/SafeUserSession";
import { TenantUser } from "@prisma/client";
import { Request } from "express";

declare module "express-serve-static-core" {
    interface Request {
        user?: SafeUser;
        tenantUser?: TenantSafeUser;
        userSession?: SafeUserSession;

    }

}
