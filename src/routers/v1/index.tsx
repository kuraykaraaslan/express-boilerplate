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
import BlogRouter from "./BlogRouter";
import AuthService from "../../services/AuthService";
import NotificationRouter from "./NotificationRouter";

const v1Router = express.Router();


// Correcting the ENABLE_TENANCY variable to be evaluated dynamically
const ENABLE_TENANCY = () => process.env.ENABLE_TENANCY === "true";

// Improving the handling of routing based on the dynamic value of ENABLE_TENANCY
v1Router.use("/tenants", (req, res, next) => {
  if (ENABLE_TENANCY()) {
    TenantRouter(req, res, next);
  } else {
    res.status(404).send({ message: "Not Found" });
  }
});

// Correcting the ENABLE_AUTH variable to be evaluated dynamically
const ENABLE_AUTH = () => process.env.ENABLE_AUTH === "true";

// Improving the handling of routing based on the dynamic value of ENABLE_AUTH
v1Router.use("/auth", (req, res, next) => {
  if (ENABLE_AUTH()) {
    AuthRouter(req, res, next);
  } else {
    res.status(404).send({ message: "Not Found" });
  }
});

// Correcting the ENABLE_USER variable to be evaluated dynamically
const ENABLE_USER = () => process.env.ENABLE_USER === "true";

// Improving the handling of routing based on the dynamic value of ENABLE_USER
v1Router.use("/users", (req, res, next) => {
  if (ENABLE_USER()) {
    UserRouter(req, res, next);
  } else {
    res.status(404).send({ message: "Not Found" });
  }
}); 

// Correcting the ENABLE_BLOG variable to be evaluated dynamically
const ENABLE_BLOG = () => process.env.ENABLE_BLOG === "true";

/* Improving the handling of routing based on the dynamic value of ENABLE_BLOG
v1Router.use("/blog", (req, res, next) => {
  if (ENABLE_BLOG()) {
    BlogRouter(req, res, next);
  } else {
    res.status(404).send({ message: "Not Found" });
  }
});
*/

// Correcting the ENABLE_NOTIFICATION variable to be evaluated dynamically
const ENABLE_NOTIFICATIONS = () => process.env.ENABLE_NOTIFICATIONS === "true";

// Improving the handling of routing based on the dynamic value of ENABLE_NOTIFICATION
v1Router.use("/notifications", (req, res, next) => {
  if (ENABLE_NOTIFICATIONS()) {
    NotificationRouter(req, res, next);
  } else {
    res.status(404).send({ message: "Not Found" });
  }
});

export default v1Router;
