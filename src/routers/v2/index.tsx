/*
    This file is used to combine all the routers of version 1
    and export them as a single router.
*/
import express from "express";
import TenantRouter from "./TenantRouter";

const v2Router = express.Router();

v2Router.get("/", (req, res) => {
  res.send({ message: "API_VERSION_2_OK" });
});

v2Router.use("/tenants", TenantRouter);

export default v2Router;
