/*
    This file is responsible for handling all the routes related to the tenant.
    If there is a route that is related to the tenant, it should be here.
*/

import express from "express";
import TenantService from "../../services/TenantService";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import Response from "../../response/Response";
import Request from "../../request/Request";
import authMiddleware from "../../middlewares/authMiddleware";
import tenantMiddleware from "../../middlewares/v2/tenantMiddleware";

const TenantRouter = express.Router();

/*
    Those routes are private and can only be accessed by authenticated users.
*/

TenantRouter.use(tenantMiddleware("GUEST"));

TenantRouter.get("/",
    errorHandlerWrapper(async (req: Request, res: Response) => {
      
        return res.status(201).json({ message: "TENANT_OK" });

    }),
);

TenantRouter.use(authMiddleware("USER"));





export default TenantRouter;