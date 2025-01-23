import AuthUserResponse from "../dtos/responses/AuthUserResponse";
import AuthUserSessionResponse from "../dtos/responses/AuthUserSessionResponse";
import { UserSession } from "@prisma/client";
import { Request } from "express";

declare module "express-serve-static-core" {
    interface Request {
        user?: AuthUserResponse; // Replace 'User' with the actual type of your user object
        userSession?: AuthUserSessionResponse; // Replace 'UserSession' with the actual type of your user session object
    }
}
