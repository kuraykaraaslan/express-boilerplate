/*
    This file is used to combine all the routers of version 1
    and export them as a single router.
*/
import express from "express";
import AuthRouter from "./AuthRouter";
import UserRouter from "./UserRouter";

const v1Router = express.Router();

v1Router.get("/", (req, res) => {
  res.send({ message: "API_VERSION_1_OK" });
});

v1Router.use("/auth", AuthRouter);
v1Router.use("/users", UserRouter);

export default v1Router;
