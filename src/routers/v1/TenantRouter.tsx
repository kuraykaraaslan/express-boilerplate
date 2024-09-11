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
import tenantMiddleware from "../../middlewares/v1/tenantMiddleware";

// Child routers
import TenantMemberRouter from "./TenantMemberRouter";

const TenantRouter = express.Router();

/*
    Those routes are private and can only be accessed by authenticated users.
*/
TenantRouter.use(authMiddleware("USER"));

TenantRouter.get
    ("/",
        authMiddleware("ADMIN"), // Elevation of privilages
        errorHandlerWrapper(async (req : Request, res : Response) => {
            let { page, pageSize } = req.query as any;

            if (!page) {
                page = 0;
            }

            if (!pageSize) {
                pageSize = 10;
            }

            const regex = /^[0-9]+$/;

            if (!regex.test(page) || !regex.test(pageSize)) {
                return res.status(400).json({ message: "INVALID_PAGE_OR_PAGE_SIZE" });
            }

            const result = await TenantService.listAllTenants(page, pageSize);

            return res.status(201).json(result);
        }),
    );

TenantRouter.post
    ("/",
        authMiddleware("ADMIN"), // Elevation of privilages
        errorHandlerWrapper(async (req : Request, res : Response) => {
            const { name , domain } = req.body as any;

            const result = await TenantService.createTenant(domain, name);

            return res.status(201).json(result);
        }),
    );


TenantRouter.get
    ("/:tenantId",
        tenantMiddleware("USER"), // Elevation of privilages
        errorHandlerWrapper(async (req : Request, res : Response) => {
            const { tenantId } = req.params;

            if (!tenantId) {
                return res.status(400).json({ message: "INVALID_TENANT_ID" });
            }

            const result = await TenantService.getTenantById(tenantId);

            return res.status(201).json(result);
        }),
    );


TenantRouter.use("/:tenantId/members",
    tenantMiddleware("USER"),
    TenantMemberRouter
);




export default TenantRouter;