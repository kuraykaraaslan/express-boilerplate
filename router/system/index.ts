import { Router } from "express";

import userRouter from "./user";
import authRouter from "./auth";
import tenantRouter from "./tenant";
import paymentRouter from "./payment";
import couponRouter from "./coupon";
import storageRouter from "./storage";
import userProfileRouter from "./user_profile";
import userPreferencesRouter from "./user_preferences";
import userSecurityRouter from "./user_security";
import { SystemDataSource } from "@/modules/db/db.system";
import redis from "@/modules/redis";

const systemRouter = Router();

systemRouter.use("/auth", authRouter);
systemRouter.use("/users", userRouter);
systemRouter.use("/users/me/profile", userProfileRouter);
systemRouter.use("/users/me/preferences", userPreferencesRouter);
systemRouter.use("/users/me/security", userSecurityRouter);
systemRouter.use("/payments", paymentRouter);
systemRouter.use("/coupons", couponRouter);
systemRouter.use("/storage", storageRouter);
systemRouter.use("/tenants", tenantRouter);



systemRouter.get("/health", async (_req, response) => {
    const redisStatus = await redis.ping()
        .then(() => true)
        .catch(() => false);
    const dbStatus = await SystemDataSource.query('SELECT 1')
        .then(() => true)
        .catch(() => false);
    const serverStatus = true;

    response.status(200).json({
        message: "OK",
        databaseStatus: dbStatus ? "OK" : "ERROR",
        redisStatus: redisStatus ? "OK" : "ERROR",
        serverStatus: serverStatus ? "OK" : "ERROR",
    });
});

systemRouter.get("/", (req, res) => {
      res.json({
        message: "Welcome to the API",
        version: process.env.npm_package_version,
        env: process.env.NODE_ENV,
    });
});


export default systemRouter;
