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
import AuthService from "../../services/AuthService";
import TenantMemberService from "../../services/Tenant/TenantMemberService";

const TenantRouter = express.Router();

/*
    Those routes are public and can be accessed by anyone.  Sensible data should not be exposed here.
*/
TenantRouter.get("/get-by-domain/:domain",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { domain } = req.params;

        console.log(domain);

        const result = await TenantService.getTenantByDomain(domain);

        const publicade = {
            tenantId: result.tenantId,
            name: result.name,
            domain: result.domain,
            logo: result.logo,
            favicon: result.favicon,
        };

        return res.status(201).json(publicade);
    }),
);

TenantRouter.get("/get-by-url/:url",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { url } = req.params;

        console.log(url);

        const result = await TenantService.getTenantByURL(url);

        const publicade = {
            tenantId: result.tenantId,
            name: result.name,
            domain: result.domain,
            logo: result.logo,
            favicon: result.favicon,
        };

        return res.status(201).json(publicade);
    }),
);


/*
    Those routes are private and can only be accessed by authenticated users.
*/
TenantRouter.use(authMiddleware("USER"));

TenantRouter.get("/me",
    errorHandlerWrapper(async (req: Request, res: Response) => {

        let {page, pageSize} = req.query as any;

        if (!page) {
            page = 0;
        }

        if (!pageSize) {
            pageSize = 10;
        }

        const result = await TenantMemberService.getTenantMembershipsByUser(req.user, page, pageSize);

        return res.status(201).json(result);
    }),
);


TenantRouter.get
    ("/",
        authMiddleware("ADMIN"), // Elevation of privilages
        errorHandlerWrapper(async (req: Request, res: Response) => {
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
        errorHandlerWrapper(async (req: Request, res: Response) => {
            const { name, domain } = req.body as any;

            const result = await TenantService.createTenant(domain, name);

            return res.status(201).json(result);
        }),
    );


TenantRouter.get
    ("/:tenantId",
        tenantMiddleware("USER"), // Elevation of privilages
        errorHandlerWrapper(async (req: Request, res: Response) => {
            const { tenantId } = req.params;

            if (!tenantId) {
                return res.status(400).json({ message: "INVALID_TENANT_ID" });
            }

            const result = await TenantService.getTenantById(tenantId);

            return res.status(201).json(result);
        }),
    );

TenantRouter.put
    ("/:tenantId",
        tenantMiddleware("ADMIN"), // Elevation of privilages
        errorHandlerWrapper(async (req: Request, res: Response) => {
            const { tenantId } = req.params;
            const { name, domain, logo, favicon, theme, timezone } = req.body as any;

            // if there is domain, check if the user is admin
            console.log(req.user.roles);

            const data = {
                name,
                domain,
                logo,
                favicon,
                theme,
                timezone
            };

            const result = await TenantService.updateTenant(tenantId, data);

            return res.status(201).json(result);
        }
        ),
    );

TenantRouter.delete
    ("/:tenantId",
        tenantMiddleware("ADMIN"), // Elevation of privilages
        authMiddleware("ADMIN"), // Elevation of privilages
        errorHandlerWrapper(async (req: Request, res: Response) => {
            const { tenantId } = req.params;

            const result = await TenantService.deleteTenant(tenantId);

            return res.status(201).json(result);
        }),
    );


TenantRouter.use("/:tenantId/members",
    tenantMiddleware("USER"),
    TenantMemberRouter
);




export default TenantRouter;