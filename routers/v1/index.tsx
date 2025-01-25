import AuthRouter from "./AuthRouter";
import UserRouter from "./UserRouter";
import SSORouter from "./SSORouter";
import { Router, Request, Response } from "express";

// Router
const V1Router = Router();

V1Router.get("/", (req: Request, res: Response) => {
    res.json({ message: "Welcome to the API v1" });
} );

V1Router.use("/users", UserRouter);
V1Router.use("/auth", AuthRouter);
V1Router.use("/sso", SSORouter);

export default V1Router;