/*
    This file is responsible for handling all the routes related to the user.
*/
import express from "express";
import errorHandlerWrapper from "../../utils/errorHandlerWrapper";
import authMiddleware from "../../middlewares/authMiddleware";
import Response from "../../response/Response";
import Request from "../../request/Request";

import UserService from "../../services/UserService";
import { User } from "../../libs/prisma";

const UserRouter = express.Router();

/*
    Those routes are private and can only be accessed by authenticated users.
*/

UserRouter.use(authMiddleware("USER"));

UserRouter.get(
  "/",
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

    const result = await UserService.listAllUsers(page, pageSize);

    return res.status(201).json(result);
  }),
);

UserRouter.post(
  "/",
  authMiddleware("ADMIN"), // Elevation of privilages
  errorHandlerWrapper(async (req : Request, res : Response) => {
    const { email, password } = req.body as any;

    const result = await UserService.createUser(email, password);

    return res.status(201).json(result);
  }),
);

UserRouter.get(
  "/:userId",

  errorHandlerWrapper(async (req : Request, res : Response) => {
    const { userId } = req.params;

    if (req.user?.id !== userId && !req.user?.roles.includes("ADMIN")) {
      return res.status(401).json({ message: "UNAUTHORIZED" });
    }

    const result = await UserService.getUserById(userId) as User;

    return res.status(201).json(result);
  }),
);

UserRouter.delete(
  "/:userId",

  errorHandlerWrapper(async (req : Request, res : Response) => {
    const { userId } = req.params;

    const result = await UserService.deleteUser(userId);

    return res.status(201).json(result);
  }),
);


export default UserRouter;
