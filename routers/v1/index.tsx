import V1 from "twilio/lib/rest/accounts/V1";
import AuthRouter from "./AuthRouter";
import UserRouter from "./UserRouter";
import { Router, Request, Response } from "express";

// Router
const V1Router = Router();

V1Router.get("/", (req: Request, res: Response) => {
    res.json({ message: "Welcome to the API v1" });
} );

V1Router.use("/users", UserRouter);
V1Router.use("/auth", AuthRouter);

export default V1Router;