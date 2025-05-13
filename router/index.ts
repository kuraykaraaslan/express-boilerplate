import authRouter from "../src/auth/router";
import userRouter from "../src/user/router";
import ssoRouter from "../src/auth/router/ssoRouter";
import tenantRouter from "../src/tenant/router";
import { Router, Request, Response } from "express";

// Router
const apiRouter = Router();

apiRouter.get("/", (req: Request, res: Response) => {
    res.json({ message: "Welcome to the API v1" });
} );

// Allow token generation WITHOUT requiring token
apiRouter.get("/csrf-token", (request: Request, response: Response) => {

    response.cookie('XSRF-TOKEN', request.csrfToken(), {
        httpOnly: false,
        secure: process.env.NODE_ENV === "production",
        maxAge: 60 * 60 * 24 * 7, // 1 week
    });

    response.status(200).json({ csrfToken: request.csrfToken() });
});

apiRouter.get("/health", (req: Request, res: Response) => {
    res.status(200).json({ message: "OK" });
} );


apiRouter.use("/users", userRouter);
apiRouter.use("/auth", authRouter);
apiRouter.use("/sso", ssoRouter);
apiRouter.use("/tenants", tenantRouter);

export default apiRouter;