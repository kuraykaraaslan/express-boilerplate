/*
    This file is used to combine all the routers of version 1
    and export them as a single router.
*/
import express from "express";
import TenantRouter from "./TenantRouter";

const v1Router = express.Router();

v1Router.get("/", (req, res) => {
  res.send({ message: "API_VERSION_2_OK" });
});

v1Router.use("/tenants", TenantRouter);

export default v1Router;