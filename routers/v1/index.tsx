import ErrorHandler from "../../middlewares/ErrorHandler";
import AuthRouter from "./AuthRouter";
import UserRouter from "./UserRouter";
import { Router, Request, Response } from "express";

const V1Router = Router();

V1Router.get("/", (req: Request, res: Response) => {
    res.send("API v1");
} );

V1Router.use("/users", UserRouter);
V1Router.use("/auth", AuthRouter);

export default V1Router;