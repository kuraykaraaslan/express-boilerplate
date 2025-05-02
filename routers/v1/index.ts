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

// Allow token generation WITHOUT requiring token
V1Router.get("/csrf-token", (request: Request, response: Response) => {

    response.cookie('XSRF-TOKEN', request.csrfToken(), {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    response.status(200).json({ csrfToken: request.csrfToken() });
});

V1Router.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ message: "OK" });
} );


V1Router.use("/users", userRouter);
V1Router.use("/auth", authRouter);
V1Router.use("/sso", ssoRouter);
V1Router.use("/tenants", tenantRouter);

export default V1Router;