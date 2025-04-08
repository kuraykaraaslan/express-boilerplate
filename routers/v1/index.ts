import authRouter from "./authRouter";
import userRouter from "./userRouter";
import ssoRouter from "./authRouter/ssoRouter";
import tenantRouter from "./tenantRouter";
import { Router, Request, Response } from "express";

// Router
const V1Router = Router();

V1Router.get("/", (req: Request, res: Response) => {
    res.json({ message: "Welcome to the API v1" });
} );

V1Router.use("/users", userRouter);
V1Router.use("/auth", authRouter);
V1Router.use("/sso", ssoRouter);
V1Router.use("/tenants", tenantRouter);

export default V1Router;