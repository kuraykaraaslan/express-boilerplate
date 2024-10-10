import express from "express";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import authMiddleware from "../../middlewares/authMiddleware";
import Response from "../../response/Response";
import Request from "../../request/Request";

import NotificationService from "../../services/NotificationService";
import { Notification } from "../../libs/prisma";

const NotificationRouter = express.Router();

/*
    Those routes are private and can only be accessed by authenticated users.
*/

NotificationRouter.use(authMiddleware("USER"));

NotificationRouter.get(
    "/",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        return res.status(201).json({ message: "NotificationRouter" });
    }
    ));

NotificationRouter.get(
    "/get-user-notifications",
    errorHandlerWrapper(async (req: Request, res: Response) => {
        const { userId } = req.user;
        let { page, pageSize } = req.query as any;

        if (!page) {
            page = 0;
        }

        if (!pageSize) {
            pageSize = 10;
        }


        const result = await NotificationService.getUserNotifications(userId, page, pageSize);

        return res.status(201).json(result);
    }),
);

export default NotificationRouter;