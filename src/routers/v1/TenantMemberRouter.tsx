/*
    This file is responsible for handling all the routes related to the tenant.
    If there is a route that is related to the tenant, it should be here.
*/

import express from "express";
import TenantService from "../../services/TenantService";
import TenantMemberService from "../../services/TenantMemberService";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import Response from "../../response/Response";
import Request from "../../request/Request";


import authMiddleware from "../../middlewares/authMiddleware";
import tenantMiddleware from "../../middlewares/v1/tenantMiddleware";

const TenantMemberRouter = express.Router();

/*
    Those routes are private and can only be accessed by authenticated users.
*/
TenantMemberRouter.use(authMiddleware("USER"));

TenantMemberRouter.get
    ("/",
        tenantMiddleware("USER"),
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

            const result = await TenantMemberService.listAllTenantMemberships(page, pageSize);

            return res.status(201).json(result);
        }),
    );

TenantMemberRouter.post
    ("/",
        authMiddleware("ADMIN"),
        errorHandlerWrapper(async (req: Request, res: Response) => {

            const { userId, roles } = req.body as any;

            const result = await TenantMemberService.createMembershipWithUserId(req.tenant, userId, roles);

            return res.status(201).json(result);
        }),
    );

TenantMemberRouter.get
    ("/invitations",
        tenantMiddleware("ADMIN"),
        errorHandlerWrapper(async (req: Request, res: Response) => {

            var { page, pageSize } = req.query as any;

            if (!page) {
                page = 0;
            }

            if (!pageSize) {
                pageSize = 10;
            }

            const result = await TenantMemberService.listAllInvitationsByTenant(req.tenant, page, pageSize);

            return res.status(201).json(result);
        }),
    );

TenantMemberRouter.post
    ("/invitations",
        tenantMiddleware("ADMIN"),
        errorHandlerWrapper(async (req: Request, res: Response) => {

            const { email } = req.body as any;

            const result = await TenantMemberService.inviteUser(req.tenant, email);

            return res.status(201).json(result);
        }),
    );

TenantMemberRouter.post
    ("/invitations/:invitationId/accept",
        errorHandlerWrapper(async (req: Request, res: Response) => {

            const { invitationId } = req.params;

            const result = await TenantMemberService.acceptInvitation(req.tenant, req.user, invitationId);

            return res.status(201).json(result);
        }),
    );

TenantMemberRouter.get
    ("/:tenantMemberId",
        tenantMiddleware("USER"),
        errorHandlerWrapper(async (req: Request, res: Response) => {

            const membership = req.tenantMember;

            const tenant = req.tenant;

            if (membership.tenantId !== tenant.tenantId) {
                throw new Error("INVALID_MEMBERSHIP");
            }

            return res.status(201).json(membership);

        }),
    );

TenantMemberRouter.post
    ("/:tenantMemberId",
        tenantMiddleware("ADMIN"),
        errorHandlerWrapper(async (req: Request, res: Response) => {

            const { roles, status } = req.body as any;

            const tenant = req.tenant;

            const membership = req.tenantMember;

            if (membership.tenantId !== tenant.tenantId) {
                throw new Error("INVALID_MEMBERSHIP");
            }

            const result = await TenantMemberService.updateMembership(membership, roles);

            return res.status(201).json(result);

        }),
    );

TenantMemberRouter.delete
    ("/:tenantMemberId",
        tenantMiddleware("ADMIN"),
        errorHandlerWrapper(async (req: Request, res: Response) => {

            const membership = req.tenantMember;

            const tenant = req.tenant;

            if (membership.tenantId !== tenant.tenantId) {
                throw new Error("INVALID_MEMBERSHIP");
            }

            const result = await TenantMemberService.deleteMembership(membership);

            return res.status(201).json(result);

        }),
    );


export default TenantMemberRouter;
