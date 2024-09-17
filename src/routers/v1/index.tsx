/*
    This file is used to combine all the routers of version 1
    and export them as a single router.
*/

import Response from "../../response/Response";
import Request from "../../request/Request";

import express from "express";
import AuthRouter from "./AuthRouter";
import UserRouter from "./UserRouter";
import TenantRouter from "./TenantRouter";
import AuthService from "../../services/AuthService";

const v1Router = express.Router();

v1Router.get("/", (req: Request, res: Response) => {
  
  AuthService.increaseCount();

  res.send({ message: AuthService.count}); 
});


v1Router.use("/auth", AuthRouter);
v1Router.use("/users", UserRouter);
v1Router.use("/tenants", TenantRouter);

export default v1Router;
